import { db } from '../db';
import type {
  CountRecord,
  Loc,
  Product,
  Session,
  StockOutDocument,
  StockOutLine,
  StockOutReason,
  StockOutStatus,
  Unit,
} from '../types';
import { sumByUnit } from './records';
import { buildCsvString, formatDateTimeIso, formatDateYmd, triggerCsvDownload } from './csvManager';
import { uid, norm } from './util';

export class StockOutError extends Error {
  code: string;
  details?: any;
  constructor(code: string, message: string, details?: any) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

/**
 * Sequential counter for Stock OUT documents (OUT-000001, OUT-000002, ...).
 */
export async function nextStockOutDocNoInTx(): Promise<string> {
  let counter = ((await db.meta.get('stockOutCounter'))?.value as number | undefined) ?? 0;
  for (;;) {
    counter += 1;
    const docNo = 'OUT-' + String(counter).padStart(6, '0');
    const clash = await db.stockOuts.where('docNo').equals(docNo).first();
    if (!clash) {
      await db.meta.put({ key: 'stockOutCounter', value: counter });
      return docNo;
    }
  }
}

export const nextStockOutDocNo = () => db.transaction('rw', db.meta, db.stockOuts, nextStockOutDocNoInTx);

/**
 * Calculates current available stock for a product across active records.
 * Can be scoped to a specific warehouse or location if provided.
 */
export async function getAvailableStockForProduct(
  productId: string,
  unit?: Unit,
  warehouse?: string,
  locationId?: string
): Promise<{ availableByUnit: Record<string, number>; availableInUnit: number }> {
  let records = await db.records.where('productId').equals(productId).filter((r) => !r.voidedAt).toArray();

  if (locationId) {
    records = records.filter((r) => r.locationId === locationId);
  } else if (warehouse) {
    // Filter by sessions that match warehouse
    const sessions = await db.sessions.where('warehouse').equals(warehouse).toArray();
    const sessionIds = new Set(sessions.map((s) => s.id));
    records = records.filter((r) => sessionIds.has(r.sessionId));
  }

  const availableByUnit = sumByUnit(records);
  const targetUnit = unit || 'piece';
  const availableInUnit = availableByUnit[targetUnit] ?? 0;

  return { availableByUnit, availableInUnit };
}

/**
 * Creates a new Stock OUT document in Draft mode.
 * Drafts do NOT alter stock levels.
 */
export async function createStockOutDraft(params: {
  recipient: string;
  reason: StockOutReason;
  customReason?: string;
  warehouse: string;
  locationId?: string;
  zone?: string;
  shelf?: string;
  deliveryRef?: string;
  notes?: string;
  lines?: StockOutLine[];
}): Promise<StockOutDocument> {
  return db.transaction('rw', [db.stockOuts, db.meta], async () => {
    const docNo = await nextStockOutDocNoInTx();
    const now = Date.now();
    const lines = params.lines ?? [];
    const totalQuantity = lines.reduce((acc, l) => acc + (Number(l.quantity) || 0), 0);

    const doc: StockOutDocument = {
      id: uid(),
      docNo,
      date: formatDateYmd(now),
      dateTime: now,
      recipient: norm(params.recipient),
      reason: params.reason,
      customReason: params.customReason ? norm(params.customReason) : undefined,
      warehouse: norm(params.warehouse) || 'المستودع الرئيسي',
      locationId: params.locationId,
      zone: params.zone,
      shelf: params.shelf,
      deliveryRef: params.deliveryRef ? norm(params.deliveryRef) : undefined,
      notes: params.notes ? norm(params.notes) : undefined,
      status: 'draft',
      lines,
      totalLines: lines.length,
      totalQuantity,
      createdAt: now,
      updatedAt: now,
    };

    await db.stockOuts.add(doc);
    return doc;
  });
}

/**
 * Updates an existing Draft document.
 */
export async function updateStockOutDraft(
  id: string,
  params: Partial<StockOutDocument>
): Promise<StockOutDocument> {
  return db.transaction('rw', db.stockOuts, async () => {
    const existing = await db.stockOuts.get(id);
    if (!existing) throw new StockOutError('NOT_FOUND', 'Document introuvable');
    if (existing.status !== 'draft') {
      throw new StockOutError('IMMUTABLE', 'Ce document est déjà confirmé et ne peut plus être modifié directement');
    }

    const lines = params.lines ?? existing.lines;
    const totalQuantity = lines.reduce((acc, l) => acc + (Number(l.quantity) || 0), 0);

    const updated: StockOutDocument = {
      ...existing,
      ...params,
      lines,
      totalLines: lines.length,
      totalQuantity,
      updatedAt: Date.now(),
    };

    await db.stockOuts.put(updated);
    return updated;
  });
}

/**
 * Validates stock availability for all lines in a document.
 * Returns a list of lines that exceed available stock.
 */
export async function validateDocumentStock(doc: StockOutDocument): Promise<{
  valid: boolean;
  violations: { line: StockOutLine; available: number; requested: number }[];
}> {
  const violations: { line: StockOutLine; available: number; requested: number }[] = [];

  // Group requested quantity per product & unit to prevent double-spending in multiple lines
  const requestedTotals = new Map<string, number>(); // `${productId}|${unit}` -> totalQty
  for (const line of doc.lines) {
    const key = `${line.productId}|${line.unit}`;
    requestedTotals.set(key, (requestedTotals.get(key) ?? 0) + line.quantity);
  }

  for (const line of doc.lines) {
    const { availableInUnit } = await getAvailableStockForProduct(
      line.productId,
      line.unit,
      doc.warehouse,
      line.locationId || doc.locationId
    );

    const totalReq = requestedTotals.get(`${line.productId}|${line.unit}`) ?? line.quantity;
    if (totalReq > availableInUnit) {
      violations.push({ line, available: availableInUnit, requested: totalReq });
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

/**
 * Confirms a Stock OUT document in an atomic database transaction.
 * Creates permanent `out` movement records in `db.records`.
 */
export async function confirmStockOut(docId: string, operator?: string): Promise<StockOutDocument> {
  return db.transaction('rw', [db.stockOuts, db.records, db.locations, db.sessions], async () => {
    const doc = await db.stockOuts.get(docId);
    if (!doc) throw new StockOutError('NOT_FOUND', 'Document introuvable');
    if (doc.status === 'confirmed') {
      throw new StockOutError('ALREADY_CONFIRMED', 'Ce document a déjà été confirmé');
    }
    if (doc.status === 'reversed') {
      throw new StockOutError('REVERSED', 'Ce document a été annulé/inversé');
    }
    if (!doc.lines.length) {
      throw new StockOutError('EMPTY', 'Le document ne contient aucun article');
    }

    // 1. Strict Stock Re-validation at confirmation time
    const { valid, violations } = await validateDocumentStock(doc);
    if (!valid) {
      const v = violations[0];
      throw new StockOutError(
        'INSUFFICIENT_STOCK',
        `Stock insuffisant pour "${v.line.name}": Disponible ${v.available} ${v.line.unit}, demandé ${v.requested} ${v.line.unit}`,
        violations
      );
    }

    // 2. Ensure an inventory session exists for this warehouse
    let session = await db.sessions.where('warehouse').equals(doc.warehouse).first();
    const now = Date.now();
    if (!session) {
      session = {
        id: uid(),
        name: `Sorties de stock — ${doc.warehouse}`,
        warehouse: doc.warehouse,
        date: doc.date,
        status: 'active',
        createdAt: now,
      };
      await db.sessions.add(session);
    }

    // 3. Ensure a source location exists
    let locationId = doc.locationId;
    if (!locationId) {
      const zoneName = doc.zone || 'Zone A';
      const shelfName = doc.shelf || '';
      const existingLoc = await db.locations
        .where('sessionId')
        .equals(session.id)
        .filter((l) => l.zone === zoneName && l.shelf === shelfName)
        .first();

      if (existingLoc) {
        locationId = existingLoc.id;
      } else {
        const newLoc: Loc = {
          id: uid(),
          sessionId: session.id,
          zone: zoneName,
          shelf: shelfName,
          completed: false,
          createdAt: now,
        };
        await db.locations.add(newLoc);
        locationId = newLoc.id;
      }
    }

    // 4. Generate atomic stock movement records (MovementType = 'out')
    const movementRecords: CountRecord[] = [];
    for (const line of doc.lines) {
      const rec: CountRecord = {
        id: uid(),
        sessionId: session.id,
        locationId: line.locationId || locationId,
        productId: line.productId,
        qty: line.quantity,
        unit: line.unit,
        type: 'out',
        docId: doc.id,
        docNo: doc.docNo,
        reason: doc.reason,
        recipient: doc.recipient,
        operator: operator || 'Admin',
        note: `Sortie de stock réf ${doc.docNo} - ${doc.recipient}`,
        createdAt: now,
      };
      movementRecords.push(rec);
    }

    await db.records.bulkAdd(movementRecords);

    // 5. Update document status to confirmed
    const confirmedDoc: StockOutDocument = {
      ...doc,
      status: 'confirmed',
      confirmedAt: now,
      confirmedBy: operator || 'Admin',
      updatedAt: now,
    };

    await db.stockOuts.put(confirmedDoc);
    return confirmedDoc;
  });
}

/**
 * Reverses a confirmed Stock OUT document (Controlled Reversal).
 * Voids the movement records and restores stock levels while maintaining audit trail.
 */
export async function reverseStockOut(
  docId: string,
  reversalReason?: string,
  operator?: string
): Promise<StockOutDocument> {
  return db.transaction('rw', [db.stockOuts, db.records], async () => {
    const doc = await db.stockOuts.get(docId);
    if (!doc) throw new StockOutError('NOT_FOUND', 'Document introuvable');
    if (doc.status !== 'confirmed') {
      throw new StockOutError('NOT_CONFIRMED', 'Seul un document confirmé peut être annulé/inversé');
    }

    const now = Date.now();

    // Void all linked movement records
    const linkedRecords = await db.records.where('docId').equals(docId).toArray();
    for (const r of linkedRecords) {
      await db.records.update(r.id, {
        voidedAt: now,
        note: `Annulation sortie ${doc.docNo}: ${reversalReason || 'Inversé'}`,
      });
    }

    const reversedDoc: StockOutDocument = {
      ...doc,
      status: 'reversed',
      reversedAt: now,
      reversedBy: operator || 'Admin',
      reversalReason: reversalReason ? norm(reversalReason) : undefined,
      updatedAt: now,
    };

    await db.stockOuts.put(reversedDoc);
    return reversedDoc;
  });
}

/**
 * Duplicates an existing document as a new Draft.
 */
export async function duplicateStockOutAsDraft(sourceDocId: string): Promise<StockOutDocument> {
  const source = await db.stockOuts.get(sourceDocId);
  if (!source) throw new StockOutError('NOT_FOUND', 'Document source introuvable');

  return createStockOutDraft({
    recipient: source.recipient,
    reason: source.reason,
    customReason: source.customReason,
    warehouse: source.warehouse,
    locationId: source.locationId,
    zone: source.zone,
    shelf: source.shelf,
    deliveryRef: source.deliveryRef,
    notes: source.notes ? `Dupliqué de ${source.docNo}: ${source.notes}` : `Dupliqué de ${source.docNo}`,
    lines: source.lines.map((l) => ({ ...l, id: uid() })),
  });
}

/**
 * Exports a Stock OUT document to CSV format.
 */
export function exportStockOutDocumentToCsv(doc: StockOutDocument): void {
  const headers = [
    'Document No',
    'Date',
    'Status',
    'Recipient',
    'Reason',
    'Warehouse',
    'Zone',
    'Shelf',
    'Delivery Reference',
    'Line No',
    'Product ID',
    'Product Name',
    'Reference',
    'Barcode',
    'Quantity Out',
    'Unit',
    'Notes',
  ];

  const rows = doc.lines.map((line, idx) => [
    doc.docNo,
    doc.date,
    doc.status,
    doc.recipient,
    doc.reason,
    doc.warehouse,
    line.zone || doc.zone || '',
    line.shelf || doc.shelf || '',
    doc.deliveryRef || '',
    idx + 1,
    line.productId,
    line.name,
    line.reference || '',
    line.barcode || '',
    line.quantity,
    line.unit,
    doc.notes || '',
  ]);

  const csv = buildCsvString(headers, rows, ';', true);
  triggerCsvDownload(`BON_SORTIE_${doc.docNo}_${formatDateYmd()}.csv`, csv);
}

/**
 * Exports a list of Stock OUT documents to a summary / detailed CSV.
 */
export function exportStockOutHistoryToCsv(docs: StockOutDocument[]): void {
  const headers = [
    'Document No',
    'Date',
    'DateTime',
    'Status',
    'Recipient',
    'Reason',
    'Warehouse',
    'Zone',
    'Shelf',
    'Delivery Reference',
    'Total Lines',
    'Total Quantity',
    'Confirmed At',
    'Confirmed By',
    'Reversed At',
    'Reversed By',
    'Reversal Reason',
    'Notes',
  ];

  const rows = docs.map((doc) => [
    doc.docNo,
    doc.date,
    formatDateTimeIso(doc.dateTime),
    doc.status,
    doc.recipient,
    doc.reason,
    doc.warehouse,
    doc.zone || '',
    doc.shelf || '',
    doc.deliveryRef || '',
    doc.totalLines,
    doc.totalQuantity,
    doc.confirmedAt ? formatDateTimeIso(doc.confirmedAt) : '',
    doc.confirmedBy || '',
    doc.reversedAt ? formatDateTimeIso(doc.reversedAt) : '',
    doc.reversedBy || '',
    doc.reversalReason || '',
    doc.notes || '',
  ]);

  const csv = buildCsvString(headers, rows, ';', true);
  triggerCsvDownload(`HISTORIQUE_SORTIES_${formatDateYmd()}.csv`, csv);
}

/**
 * Fetches dashboard and analytics metrics for Stock OUT operations.
 */
export async function getStockOutStats() {
  const docs = await db.stockOuts.toArray();
  const confirmedDocs = docs.filter((d) => d.status === 'confirmed');
  const draftDocs = docs.filter((d) => d.status === 'draft');
  const reversedDocs = docs.filter((d) => d.status === 'reversed');

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const startOfMonthMs = startOfMonth.getTime();

  let totalQuantitiesIssued = 0;
  let totalProductsIssued = 0;
  let todayQuantitiesIssued = 0;
  let monthQuantitiesIssued = 0;

  const productFreq = new Map<string, { productId: string; name: string; totalQty: number; count: number }>();

  for (const doc of confirmedDocs) {
    totalQuantitiesIssued += doc.totalQuantity;
    totalProductsIssued += doc.totalLines;

    const isToday = (doc.confirmedAt ?? doc.dateTime) >= startOfTodayMs;
    const isThisMonth = (doc.confirmedAt ?? doc.dateTime) >= startOfMonthMs;

    if (isToday) todayQuantitiesIssued += doc.totalQuantity;
    if (isThisMonth) monthQuantitiesIssued += doc.totalQuantity;

    for (const l of doc.lines) {
      const entry = productFreq.get(l.productId) ?? { productId: l.productId, name: l.name, totalQty: 0, count: 0 };
      entry.totalQty += l.quantity;
      entry.count += 1;
      productFreq.set(l.productId, entry);
    }
  }

  const topProducts = Array.from(productFreq.values())
    .sort((a, b) => b.totalQty - a.totalQty)
    .slice(0, 5);

  return {
    totalDocs: docs.length,
    confirmedDocsCount: confirmedDocs.length,
    draftDocsCount: draftDocs.length,
    reversedDocsCount: reversedDocs.length,
    totalQuantitiesIssued,
    totalProductsIssued,
    todayQuantitiesIssued,
    monthQuantitiesIssued,
    topProducts,
  };
}

