import { db } from '../db';
import type { BarcodeItem, CountRecord, Loc, Product, Session, Unit } from '../types';
import { UNITS } from '../types';
import { saveBlob } from './util';
import { nextInternalBarcodeInTx } from './barcodes';
import { sumByUnit, addRecord } from './records';
import { uid, norm } from './util';
import { isTmpRef, refKeyOf } from './products';

export interface CsvExportOptions {
  delimiter?: ';' | ',';
  excelTextProtection?: boolean;
  filterCategory?: string;
  filterWarehouse?: string;
  filterZone?: string;
  filterShelf?: string;
  filterStockStatus?: 'all' | 'low' | 'zero' | 'no_barcode' | 'unknown';
  customProducts?: Product[];
}

export interface DetailedStockRow {
  productId: string;
  name: string;
  reference: string;
  barcode: string;
  warehouse: string;
  zone: string;
  shelf: string;
  quantity: number;
  unit: string;
}

export function formatDateTimeIso(timestamp?: number): string {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const min = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

export function formatDateYmd(timestamp: number = Date.now()): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Escapes a cell value for CSV.
 * Handles quotes, commas, semicolons, line breaks.
 * If protectText is true and value has leading zeros or looks numeric (e.g. barcodes),
 * formats as ="value" so Excel preserves text formatting without converting to scientific notation.
 */
export function formatCsvCell(val: unknown, delimiter = ';', protectText = false): string {
  if (val === null || val === undefined) return '';
  const s = String(val).trim();

  // Excel text preservation for barcodes / references with leading zeros or digits > 10 chars
  if (protectText && s.length > 0) {
    const isBarcodeOrLeadingZero = /^\d+$/.test(s) && (s.length >= 10 || s.startsWith('0'));
    if (isBarcodeOrLeadingZero) {
      return `="${s.replace(/"/g, '""')}"`;
    }
  }

  const needsQuotes =
    s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r');
  if (needsQuotes) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Builds UTF-8 CSV content with BOM (\uFEFF) for Microsoft Excel compatibility.
 */
export function buildCsvString(headers: string[], rows: (string | number)[][], delimiter = ';', protectText = false): string {
  const lines: string[] = [];
  lines.push(headers.map((h) => formatCsvCell(h, delimiter, false)).join(delimiter));
  for (const r of rows) {
    lines.push(r.map((c) => formatCsvCell(c, delimiter, protectText)).join(delimiter));
  }
  return '\uFEFF' + lines.join('\r\n');
}

/**
 * Helper to download CSV string as a file.
 */
export function triggerCsvDownload(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  saveBlob(blob, filename.endsWith('.csv') ? filename : filename + '.csv');
}

// ---------------------------------------------------------------------------
// 1. PRODUCT MASTER CSV EXPORT
// ---------------------------------------------------------------------------

export const PRODUCT_MASTER_HEADERS = [
  'Internal Product ID',
  'Product Name',
  'Product Reference',
  'Original Manufacturer Barcode',
  'Internal Generated Barcode',
  'All Associated Barcodes',
  'Barcode Type',
  'Category',
  'Description',
  'Unit of Measurement',
  'Carton Conversion',
  'Current Total Stock',
  'Minimum Stock Alert',
  'Warehouse',
  'Zone',
  'Shelf / Location',
  'Creation Date',
  'Last Updated',
  'Product Status',
];

export async function exportProductMasterCsv(options: CsvExportOptions = {}): Promise<void> {
  const delimiter = options.delimiter ?? ';';
  const protectText = options.excelTextProtection ?? true;

  // 1. Load products
  let products = options.customProducts ?? (await db.products.filter((p) => !p.mergedInto).toArray());

  // 2. Load all records, locations, sessions for stock and location data
  const [allRecords, allLocations, allSessions] = await Promise.all([
    db.records.filter((r) => !r.voidedAt).toArray(),
    db.locations.toArray(),
    db.sessions.toArray(),
  ]);

  const locMap = new Map<string, Loc>(allLocations.map((l) => [l.id, l]));
  const sessMap = new Map<string, Session>(allSessions.map((s) => [s.id, s]));

  // Index active records by productId
  const recordsByProduct = new Map<string, CountRecord[]>();
  for (const r of allRecords) {
    const list = recordsByProduct.get(r.productId) ?? [];
    list.push(r);
    recordsByProduct.set(r.productId, list);
  }

  // 3. Compute stock and locations per product
  interface ProdMeta {
    totalStockStr: string;
    totalStockNum: number;
    warehouses: string[];
    zones: string[];
    shelves: string[];
  }
  const prodMetaMap = new Map<string, ProdMeta>();

  for (const p of products) {
    const recs = recordsByProduct.get(p.id) ?? [];
    const stockMap = sumByUnit(recs);
    const totalStockNum = Object.values(stockMap).reduce((acc, q) => acc + q, 0);
    const totalStockStr = Object.entries(stockMap)
      .map(([u, q]) => `${q} ${u}`)
      .join(' + ');

    const warehouses = new Set<string>();
    const zones = new Set<string>();
    const shelves = new Set<string>();

    for (const r of recs) {
      const loc = locMap.get(r.locationId);
      if (loc) {
        if (loc.zone) zones.add(loc.zone);
        if (loc.shelf) shelves.add(loc.shelf);
        const sess = sessMap.get(r.sessionId);
        if (sess?.warehouse) warehouses.add(sess.warehouse);
      }
    }

    prodMetaMap.set(p.id, {
      totalStockStr: totalStockStr || '0',
      totalStockNum,
      warehouses: Array.from(warehouses),
      zones: Array.from(zones),
      shelves: Array.from(shelves),
    });
  }

  // 4. Apply Filters
  if (options.filterCategory) {
    const cat = options.filterCategory.toLowerCase();
    products = products.filter((p) => (p.category ?? '').toLowerCase() === cat);
  }
  if (options.filterWarehouse) {
    const wh = options.filterWarehouse.toLowerCase();
    products = products.filter((p) =>
      (prodMetaMap.get(p.id)?.warehouses ?? []).some((w) => w.toLowerCase() === wh)
    );
  }
  if (options.filterZone) {
    const z = options.filterZone.toLowerCase();
    products = products.filter((p) =>
      (prodMetaMap.get(p.id)?.zones ?? []).some((zone) => zone.toLowerCase() === z)
    );
  }
  if (options.filterShelf) {
    const sh = options.filterShelf.toLowerCase();
    products = products.filter((p) =>
      (prodMetaMap.get(p.id)?.shelves ?? []).some((shelf) => shelf.toLowerCase() === sh)
    );
  }
  if (options.filterStockStatus) {
    if (options.filterStockStatus === 'low') {
      products = products.filter((p) => {
        const meta = prodMetaMap.get(p.id);
        const stock = meta?.totalStockNum ?? 0;
        const min = p.minStock ?? 0;
        return stock <= min || stock <= 0;
      });
    } else if (options.filterStockStatus === 'zero') {
      products = products.filter((p) => {
        const meta = prodMetaMap.get(p.id);
        return (meta?.totalStockNum ?? 0) === 0;
      });
    } else if (options.filterStockStatus === 'no_barcode') {
      products = products.filter((p) => !p.originalBarcode && !p.barcode);
    } else if (options.filterStockStatus === 'unknown') {
      products = products.filter((p) => p.isTemp);
    }
  }

  // 5. Construct rows
  const rows: (string | number)[][] = [];

  for (const p of products) {
    const meta = prodMetaMap.get(p.id)!;

    // Associated barcodes
    const allBcs = new Set<string>();
    if (p.internalBarcode) allBcs.add(p.internalBarcode);
    if (p.originalBarcode) allBcs.add(p.originalBarcode);
    if (p.barcode) allBcs.add(p.barcode);
    for (const b of p.barcodes ?? []) allBcs.add(b.code);
    for (const a of p.aliases ?? []) allBcs.add(a);

    const barcodeType = p.originalBarcode
      ? 'Manufacturer (EAN/UPC)'
      : p.internalBarcode
      ? 'Code 128 (Internal)'
      : 'None';

    const status = p.mergedInto ? 'Merged' : p.isTemp ? 'Temporary' : 'Active';

    rows.push([
      p.id,
      p.name,
      p.reference ?? '',
      p.originalBarcode ?? '',
      p.internalBarcode ?? '',
      Array.from(allBcs).join(', '),
      barcodeType,
      p.category ?? '',
      p.description ?? '',
      p.unit,
      p.cartonQty ?? '',
      meta.totalStockStr,
      p.minStock != null ? p.minStock : '',
      meta.warehouses.join(', '),
      meta.zones.join(', '),
      meta.shelves.join(', '),
      formatDateTimeIso(p.createdAt),
      formatDateTimeIso(p.updatedAt),
      status,
    ]);
  }

  const csvContent = buildCsvString(PRODUCT_MASTER_HEADERS, rows, delimiter, protectText);
  const filename = `SMART_INVENTORY_PRODUCTS_${formatDateYmd()}.csv`;
  triggerCsvDownload(filename, csvContent);
}

// ---------------------------------------------------------------------------
// 2. DETAILED STOCK CSV EXPORT
// ---------------------------------------------------------------------------

export const DETAILED_STOCK_HEADERS = [
  'Product ID',
  'Product Name',
  'Reference',
  'Barcode',
  'Warehouse',
  'Zone',
  'Shelf',
  'Quantity',
  'Unit',
];

export async function exportDetailedStockCsv(options: CsvExportOptions = {}): Promise<void> {
  const delimiter = options.delimiter ?? ';';
  const protectText = options.excelTextProtection ?? true;

  const [products, records, locations, sessions] = await Promise.all([
    db.products.filter((p) => !p.mergedInto).toArray(),
    db.records.filter((r) => !r.voidedAt).toArray(),
    db.locations.toArray(),
    db.sessions.toArray(),
  ]);

  const prodMap = new Map<string, Product>(products.map((p) => [p.id, p]));
  const locMap = new Map<string, Loc>(locations.map((l) => [l.id, l]));
  const sessMap = new Map<string, Session>(sessions.map((s) => [s.id, s]));

  // Group by (productId + locationId + unit)
  const grouped = new Map<string, {
    productId: string;
    locationId: string;
    sessionId: string;
    unit: Unit;
    qty: number;
  }>();

  for (const r of records) {
    const key = `${r.productId}|${r.locationId}|${r.unit}`;
    const delta = r.type === 'out' ? -r.qty : r.qty;
    const existing = grouped.get(key);
    if (existing) {
      existing.qty = Math.round((existing.qty + delta) * 1000) / 1000;
    } else {
      grouped.set(key, {
        productId: r.productId,
        locationId: r.locationId,
        sessionId: r.sessionId,
        unit: r.unit,
        qty: delta,
      });
    }
  }

  const rows: (string | number)[][] = [];

  for (const item of grouped.values()) {
    if (item.qty <= 0) continue; // Only positive location balances
    const p = prodMap.get(item.productId);
    const loc = locMap.get(item.locationId);
    const sess = sessMap.get(item.sessionId);

    // Apply filters if specified
    if (options.filterWarehouse && sess?.warehouse?.toLowerCase() !== options.filterWarehouse.toLowerCase()) continue;
    if (options.filterZone && loc?.zone?.toLowerCase() !== options.filterZone.toLowerCase()) continue;
    if (options.filterShelf && loc?.shelf?.toLowerCase() !== options.filterShelf.toLowerCase()) continue;
    if (options.filterCategory && p?.category?.toLowerCase() !== options.filterCategory.toLowerCase()) continue;

    rows.push([
      item.productId,
      p?.name ?? '—',
      p?.reference ?? '',
      p?.internalBarcode || p?.barcode || '',
      sess?.warehouse ?? '',
      loc?.zone ?? '',
      loc?.shelf ?? '',
      item.qty,
      item.unit,
    ]);
  }

  // Sort by product name, zone, shelf
  rows.sort((a, b) => String(a[1]).localeCompare(String(b[1])));

  const csvContent = buildCsvString(DETAILED_STOCK_HEADERS, rows, delimiter, protectText);
  const filename = `SMART_INVENTORY_STOCK_DETAILS_${formatDateYmd()}.csv`;
  triggerCsvDownload(filename, csvContent);
}

// ---------------------------------------------------------------------------
// 3. ADVANCED CSV IMPORT & VALIDATION
// ---------------------------------------------------------------------------

export const CSV_IMPORT_FIELDS = [
  'id',
  'name',
  'reference',
  'originalBarcode',
  'internalBarcode',
  'category',
  'description',
  'unit',
  'cartonQty',
  'minStock',
  'quantity',
  'warehouse',
  'zone',
  'shelf',
] as const;

export type CsvImportField = (typeof CSV_IMPORT_FIELDS)[number];
export type CsvMapping = Record<CsvImportField, number>; // -1 = unmapped

export interface ValidationError {
  rowNumber: number;
  reference: string;
  problem: string;
  suggestion: string;
}

export interface ImportAnalysis {
  totalRows: number;
  newCount: number;
  existingCount: number;
  duplicateRefCount: number;
  duplicateBarcodeCount: number;
  invalidCount: number;
  missingRequiredCount: number;
  errors: ValidationError[];
  parsedProducts: ParsedImportRow[];
}

export interface ParsedImportRow {
  rowNumber: number;
  id?: string;
  name: string;
  reference?: string;
  originalBarcode?: string;
  internalBarcode?: string;
  category?: string;
  description?: string;
  unit: Unit;
  cartonQty?: number;
  minStock?: number;
  quantity?: number;
  warehouse?: string;
  zone?: string;
  shelf?: string;
  isExisting: boolean;
  existingId?: string;
  isValid: boolean;
  errors: string[];
}

const GUESS_IMPORT_REGEX: Record<CsvImportField, RegExp> = {
  id: /^(id|product[\s_-]*id|internal[\s_-]*id|identifiant)/i,
  name: /(name|nom|d[ée]signation|designation|libell|produit|product|اسم)/i,
  reference: /^(r[ée]f|r[ée]f[ée]rence|sku|article|code[\s_-]*art|item|part|مرجع)/i,
  originalBarcode: /(original|manufacturer|fabricant|code[\s_-]*barre[\s_-]*orig)/i,
  internalBarcode: /(internal|interne|code[\s_-]*interne|inv[\s_-]*code)/i,
  category: /(cat[ée]gor|famille|family|type|فئة)/i,
  description: /(description|d[ée]tail|desc|وصف)/i,
  unit: /(unit[ée]?|uom|وحدة)/i,
  cartonQty: /(carton|colisage|pcb|per[\s_-]*box|par[\s_-]*carton)/i,
  minStock: /(min[\s_-]*stock|stock[\s_-]*min|alert|seuil|حد[\s_-]*أدنى)/i,
  quantity: /(qty|quantit[ée]|stock|stock[\s_-]*total|comptage|كمية)/i,
  warehouse: /(warehouse|entrep[ôo]t|مستودع)/i,
  zone: /(zone|secteur|منطقة)/i,
  shelf: /(shelf|rayon|étagère|etagere|rack|رف)/i,
};

export function autoMapColumns(headers: string[]): CsvMapping {
  const mapping: CsvMapping = {
    id: -1,
    name: -1,
    reference: -1,
    originalBarcode: -1,
    internalBarcode: -1,
    category: -1,
    description: -1,
    unit: -1,
    cartonQty: -1,
    minStock: -1,
    quantity: -1,
    warehouse: -1,
    zone: -1,
    shelf: -1,
  };

  const used = new Set<number>();

  // Check specific barcodes first
  for (const f of ['internalBarcode', 'originalBarcode'] as CsvImportField[]) {
    const idx = headers.findIndex((h, i) => !used.has(i) && GUESS_IMPORT_REGEX[f].test(h));
    if (idx >= 0) {
      mapping[f] = idx;
      used.add(idx);
    }
  }

  // General barcode fallback
  if (mapping.originalBarcode === -1 && mapping.internalBarcode === -1) {
    const genBcIdx = headers.findIndex((h, i) => !used.has(i) && /(ean|barcode|code[\s_-]*barre|gtin|upc|باركود)/i.test(h));
    if (genBcIdx >= 0) {
      mapping.originalBarcode = genBcIdx;
      used.add(genBcIdx);
    }
  }

  // Map remaining fields
  for (const f of CSV_IMPORT_FIELDS) {
    if (mapping[f] >= 0) continue;
    const idx = headers.findIndex((h, i) => !used.has(i) && GUESS_IMPORT_REGEX[f].test(h));
    if (idx >= 0) {
      mapping[f] = idx;
      used.add(idx);
    }
  }

  return mapping;
}

export function parseUnitValue(s: string): Unit {
  const v = s.trim().toLowerCase();
  if (!v) return 'piece';
  if (/^(carton|ctn|cart|كرتون)/.test(v)) return 'carton';
  if (/^(bo[iî]te|box|bte|علب)/.test(v)) return 'box';
  if (/^(kg|kilo|كيلو)/.test(v)) return 'kg';
  if (/^(m|mètre|metre|meter|mt|متر)$/.test(v)) return 'meter';
  return (UNITS as string[]).includes(v) ? (v as Unit) : 'piece';
}

function cleanCell(raw: string | undefined): string {
  if (!raw) return '';
  let s = raw.trim();
  // Strip Excel text formula notation: ="value" -> value
  if (s.startsWith('="') && s.endsWith('"')) {
    s = s.slice(2, -1);
  } else if (s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1);
  }
  return s.trim();
}

/**
 * Validates and analyzes imported CSV rows before committing changes.
 */
export async function analyzeProductImport(rows: string[][], map: CsvMapping): Promise<ImportAnalysis> {
  const existingProducts = await db.products.filter((p) => !p.mergedInto).toArray();

  const byId = new Map<string, Product>();
  const byRef = new Map<string, Product>();
  const byBarcode = new Map<string, Product>();

  for (const p of existingProducts) {
    byId.set(p.id, p);
    if (p.refKey) byRef.set(p.refKey, p);
    if (p.barcode) byBarcode.set(p.barcode, p);
    if (p.internalBarcode) byBarcode.set(p.internalBarcode, p);
    if (p.originalBarcode) byBarcode.set(p.originalBarcode, p);
    for (const b of p.barcodes ?? []) byBarcode.set(b.code, p);
    for (const a of p.aliases ?? []) {
      byRef.set(a.toUpperCase(), p);
      byBarcode.set(a, p);
    }
  }

  const seenRefsInFile = new Map<string, number>(); // refKey -> rowNumber
  const seenBarcodesInFile = new Map<string, number>(); // code -> rowNumber

  const errors: ValidationError[] = [];
  const parsedProducts: ParsedImportRow[] = [];

  let newCount = 0;
  let existingCount = 0;
  let duplicateRefCount = 0;
  let duplicateBarcodeCount = 0;
  let invalidCount = 0;
  let missingRequiredCount = 0;

  const REF_RE = /^[\p{L}\p{N}][\p{L}\p{N} \-_./#+]{0,63}$/u;
  const BC_RE = /^\S{3,128}$/;

  const getCol = (r: string[], field: CsvImportField): string => {
    const idx = map[field];
    return idx >= 0 && idx < r.length ? cleanCell(r[idx]) : '';
  };

  // Skip header row at index 0
  for (let i = 1; i < rows.length; i++) {
    const rowNumber = i + 1;
    const r = rows[i];

    const id = getCol(r, 'id') || undefined;
    const name = getCol(r, 'name');
    const reference = getCol(r, 'reference') || undefined;
    const origBc = getCol(r, 'originalBarcode') || undefined;
    const internalBc = getCol(r, 'internalBarcode') || undefined;
    const category = getCol(r, 'category') || undefined;
    const description = getCol(r, 'description') || undefined;
    const unitStr = getCol(r, 'unit');
    const cqStr = getCol(r, 'cartonQty');
    const minStockStr = getCol(r, 'minStock');
    const qtyStr = getCol(r, 'quantity');
    const warehouse = getCol(r, 'warehouse') || undefined;
    const zone = getCol(r, 'zone') || undefined;
    const shelf = getCol(r, 'shelf') || undefined;

    // Skip completely empty rows
    if (!name && !reference && !origBc && !internalBc && !id) {
      continue;
    }

    const rowErrors: string[] = [];

    // Check required fields
    if (!name && !reference && !origBc && !internalBc) {
      rowErrors.push('Missing product name or identifier');
      missingRequiredCount++;
      errors.push({
        rowNumber,
        reference: reference || '—',
        problem: 'السطر لا يحتوي على اسم أو مرجع أو باركود',
        suggestion: 'أضف اسم المنتج أو مرجعه التعريفي',
      });
    }

    // Validate reference format
    if (reference && (!REF_RE.test(reference) || isTmpRef(reference))) {
      rowErrors.push('Invalid reference format');
      errors.push({
        rowNumber,
        reference,
        problem: 'تنسيق المرجع غير صالح (يجب أن يحتوي حروف وأرقام ولا يبدأ بـ TMP)',
        suggestion: 'عدّل المرجع ليكون فريدًا وصحيحًا',
      });
    }

    // Validate barcodes format
    if (origBc && !BC_RE.test(origBc)) {
      rowErrors.push('Invalid original barcode format');
      errors.push({
        rowNumber,
        reference: reference || '—',
        problem: `باركود المصنّع غير صالح (${origBc})`,
        suggestion: 'تأكد من كتابة أرقام الباركود بشكل سليم دون مسافات',
      });
    }
    if (internalBc && !BC_RE.test(internalBc)) {
      rowErrors.push('Invalid internal barcode format');
      errors.push({
        rowNumber,
        reference: reference || '—',
        problem: `الباركود الداخلي غير صالح (${internalBc})`,
        suggestion: 'يجب أن يكون من نمط INV-000000 أو اتركه فارغًا ليتم توليده',
      });
    }

    // Check file duplicate references
    if (reference) {
      const k = refKeyOf(reference)!;
      if (seenRefsInFile.has(k)) {
        duplicateRefCount++;
        rowErrors.push(`Duplicate reference in file (same as row ${seenRefsInFile.get(k)})`);
        errors.push({
          rowNumber,
          reference,
          problem: `المرجع مكرر في الملف (مشابه للسطر ${seenRefsInFile.get(k)})`,
          suggestion: 'استخدم مراجع فريدة لكل منتج',
        });
      } else {
        seenRefsInFile.set(k, rowNumber);
      }
    }

    // Check file duplicate barcodes
    const testBc = origBc || internalBc;
    if (testBc) {
      if (seenBarcodesInFile.has(testBc)) {
        duplicateBarcodeCount++;
        rowErrors.push(`Duplicate barcode in file (same as row ${seenBarcodesInFile.get(testBc)})`);
        errors.push({
          rowNumber,
          reference: reference || '—',
          problem: `الباركود (${testBc}) مكرر في الملف (مشابه للسطر ${seenBarcodesInFile.get(testBc)})`,
          suggestion: 'تأكد أن كل باركود ينتمي لمنتج واحد فقط',
        });
      } else {
        seenBarcodesInFile.set(testBc, rowNumber);
      }
    }

    // Numerical conversions
    let cartonQty: number | undefined;
    if (cqStr) {
      const n = Number(cqStr);
      if (Number.isInteger(n) && n >= 1) cartonQty = n;
      else rowErrors.push('Carton conversion must be positive integer');
    }

    let minStock: number | undefined;
    if (minStockStr) {
      const n = Number(minStockStr);
      if (Number.isFinite(n) && n >= 0) minStock = n;
      else rowErrors.push('Minimum stock must be >= 0');
    }

    let quantity: number | undefined;
    if (qtyStr) {
      const n = Number(qtyStr.replace(',', '.'));
      if (Number.isFinite(n) && n >= 0) quantity = n;
      else rowErrors.push('Quantity must be >= 0');
    }

    // Identify if row matches existing product
    let hit: Product | undefined;
    if (id && byId.has(id)) hit = byId.get(id);
    if (!hit && reference && byRef.has(refKeyOf(reference)!)) hit = byRef.get(refKeyOf(reference)!);
    if (!hit && origBc && byBarcode.has(origBc)) hit = byBarcode.get(origBc);
    if (!hit && internalBc && byBarcode.has(internalBc)) hit = byBarcode.get(internalBc);

    const isExisting = !!hit;
    if (isExisting) existingCount++;
    else newCount++;

    const isValid = rowErrors.length === 0;
    if (!isValid) invalidCount++;

    parsedProducts.push({
      rowNumber,
      id: hit?.id ?? id,
      name: name || reference || origBc || internalBc || '—',
      reference,
      originalBarcode: origBc,
      internalBarcode: hit?.internalBarcode ?? internalBc,
      category,
      description,
      unit: parseUnitValue(unitStr),
      cartonQty,
      minStock,
      quantity,
      warehouse,
      zone,
      shelf,
      isExisting,
      existingId: hit?.id,
      isValid,
      errors: rowErrors,
    });
  }

  return {
    totalRows: parsedProducts.length,
    newCount,
    existingCount,
    duplicateRefCount,
    duplicateBarcodeCount,
    invalidCount,
    missingRequiredCount,
    errors,
    parsedProducts,
  };
}

export type ImportMode = 'add_only' | 'update_existing' | 'opening_balance';

export interface ExecuteImportOptions {
  mode: ImportMode;
  targetSessionId?: string;
  createOpeningSession?: boolean;
  openingSessionName?: string;
  warehouseName?: string;
}

export interface ImportExecutionResult {
  created: number;
  updated: number;
  skipped: number;
  stockRecordsCreated: number;
  errorsCount: number;
}

/**
 * Executes the product import safely according to selected mode.
 */
export async function executeProductImport(
  analysis: ImportAnalysis,
  options: ExecuteImportOptions
): Promise<ImportExecutionResult> {
  const result: ImportExecutionResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    stockRecordsCreated: 0,
    errorsCount: analysis.errors.length,
  };

  const now = Date.now();
  const toAdd: Product[] = [];
  const toUpdate: Product[] = [];
  const stockMoves: { productId: string; qty: number; unit: Unit; zone?: string; shelf?: string }[] = [];

  for (const row of analysis.parsedProducts) {
    if (!row.isValid) {
      result.skipped++;
      continue;
    }

    if (row.isExisting && row.existingId) {
      if (options.mode === 'add_only') {
        result.skipped++;
        continue;
      }

      // Mode update_existing or opening_balance
      const existing = await db.products.get(row.existingId);
      if (existing) {
        // Protect permanent internal ID and internal barcode!
        const internalBarcode = existing.internalBarcode || (await nextInternalBarcodeInTx());

        // Protect original barcode unless existing had none
        const originalBarcode = existing.originalBarcode || row.originalBarcode;

        const aliases = new Set<string>(existing.aliases ?? []);
        aliases.add(internalBarcode);
        if (originalBarcode) aliases.add(originalBarcode);

        const barcodes: BarcodeItem[] = [...(existing.barcodes ?? [])];
        if (!barcodes.some((b) => b.type === 'internal')) {
          barcodes.unshift({ code: internalBarcode, type: 'internal', createdAt: existing.createdAt, status: 'active' });
        }
        if (originalBarcode && !barcodes.some((b) => b.code === originalBarcode)) {
          barcodes.push({ code: originalBarcode, type: 'original', createdAt: now, status: 'active' });
        }

        const updated: Product = {
          ...existing,
          name: row.name || existing.name,
          reference: row.reference || existing.reference,
          refKey: refKeyOf(row.reference || existing.reference),
          description: row.description || existing.description,
          category: row.category || existing.category,
          unit: row.unit || existing.unit,
          cartonQty: row.cartonQty ?? existing.cartonQty,
          minStock: row.minStock ?? existing.minStock,
          originalBarcode,
          internalBarcode,
          barcode: originalBarcode || existing.barcode || internalBarcode,
          barcodes,
          aliases: Array.from(aliases),
          updatedAt: now,
        };

        toUpdate.push(updated);
        result.updated++;

        if (options.mode === 'opening_balance' && row.quantity != null && row.quantity > 0) {
          stockMoves.push({
            productId: updated.id,
            qty: row.quantity,
            unit: row.unit,
            zone: row.zone,
            shelf: row.shelf,
          });
        }
      }
    } else {
      // New product
      const newId = row.id || uid();
      const internalBarcode = row.internalBarcode || (await nextInternalBarcodeInTx());
      const originalBarcode = row.originalBarcode;

      const barcodes: BarcodeItem[] = [
        { code: internalBarcode, type: 'internal', createdAt: now, status: 'active' },
      ];
      if (originalBarcode) {
        barcodes.push({ code: originalBarcode, type: 'original', createdAt: now, status: 'active' });
      }

      const aliases = new Set<string>();
      aliases.add(internalBarcode);
      if (originalBarcode) aliases.add(originalBarcode);

      const p: Product = {
        id: newId,
        name: row.name,
        reference: row.reference,
        refKey: refKeyOf(row.reference),
        barcode: originalBarcode || internalBarcode,
        originalBarcode,
        internalBarcode,
        barcodes,
        category: row.category,
        description: row.description,
        unit: row.unit,
        cartonQty: row.cartonQty,
        minStock: row.minStock,
        photoIds: [],
        isTemp: false,
        aliases: Array.from(aliases),
        createdAt: now,
        updatedAt: now,
      };

      toAdd.push(p);
      result.created++;

      if (options.mode === 'opening_balance' && row.quantity != null && row.quantity > 0) {
        stockMoves.push({
          productId: p.id,
          qty: row.quantity,
          unit: row.unit,
          zone: row.zone,
          shelf: row.shelf,
        });
      }
    }
  }

  // Commit products in bulk
  if (toAdd.length > 0) {
    await db.products.bulkAdd(toAdd);
  }
  if (toUpdate.length > 0) {
    await db.products.bulkPut(toUpdate);
  }

  // Handle Opening Balance creation if selected
  if (options.mode === 'opening_balance' && stockMoves.length > 0) {
    let sessId = options.targetSessionId;

    if (!sessId) {
      // Create an auditable opening balance session
      sessId = uid();
      const sess: Session = {
        id: sessId,
        name: options.openingSessionName || `رصيد افتتاحي (CSV Import ${formatDateYmd()})`,
        warehouse: options.warehouseName || 'المستودع الرئيسي',
        date: formatDateYmd(),
        status: 'active',
        createdAt: now,
        notes: 'تم إنشاؤه آليًا من استيراد رصيد المخزون الافتتاحي عبر ملف CSV.',
      };
      await db.sessions.add(sess);
    }

    // Ensure locations exist
    const locCache = new Map<string, string>(); // 'zone|shelf' -> locId
    const existingLocs = await db.locations.where('sessionId').equals(sessId).toArray();
    for (const l of existingLocs) locCache.set(`${l.zone}|${l.shelf}`, l.id);

    for (const m of stockMoves) {
      const z = m.zone || 'Zone A';
      const s = m.shelf || '';
      const key = `${z}|${s}`;
      let locId = locCache.get(key);

      if (!locId) {
        locId = uid();
        const newLoc: Loc = {
          id: locId,
          sessionId: sessId,
          zone: z,
          shelf: s,
          completed: false,
          createdAt: now,
        };
        await db.locations.add(newLoc);
        locCache.set(key, locId);
      }

      await addRecord({
        sessionId: sessId,
        locationId: locId,
        productId: m.productId,
        qty: m.qty,
        unit: m.unit,
        type: 'opening',
        note: 'رصيد افتتاحي من استيراد CSV',
      });
      result.stockRecordsCreated++;
    }
  }

  return result;
}

/**
 * Downloads a structured error report CSV for invalid rows.
 */
export function downloadErrorReport(errors: ValidationError[], filename = 'IMPORT_ERRORS.csv') {
  const headers = ['Row Number', 'Product Reference', 'Problem Description', 'Suggested Correction'];
  const rows = errors.map((e) => [e.rowNumber, e.reference, e.problem, e.suggestion]);
  const content = buildCsvString(headers, rows, ';', false);
  triggerCsvDownload(filename, content);
}

