import { db } from '../db';
import { DECIMAL_UNITS, type CountRecord, type Product, type Unit } from '../types';
import { fmtNum, uid } from './util';
import { AppError } from './products';

export function validateQty(qty: number, unit: Unit): number {
  if (!Number.isFinite(qty) || qty < 0 || qty > 10_000_000) throw new AppError('BAD_QTY');
  if (!DECIMAL_UNITS.includes(unit)) {
    if (!Number.isInteger(qty)) throw new AppError('BAD_QTY');
    return qty;
  }
  return Math.round(qty * 1000) / 1000;
}

export async function addRecord(p: {
  sessionId: string;
  locationId: string;
  productId: string;
  qty: number;
  unit: Unit;
}): Promise<CountRecord> {
  const qty = validateQty(p.qty, p.unit);
  const rec: CountRecord = { id: uid(), createdAt: Date.now(), ...p, qty };
  await db.records.add(rec);
  return rec;
}

/** Void a record (kept in history, excluded from totals). */
export async function voidRecord(id: string): Promise<void> {
  await db.records.update(id, { voidedAt: Date.now() });
}

/** Restore a voided record, unless a correction has replaced it. */
export async function restoreRecord(id: string): Promise<void> {
  await db.transaction('rw', db.records, async () => {
    const r = await db.records.get(id);
    if (!r || r.supersededBy) return;
    await db.records.put({ ...r, voidedAt: undefined });
  });
}

/** Correct a quantity without losing the previous value: old record is voided and linked. */
export async function correctRecord(id: string, qty: number, unit?: Unit): Promise<CountRecord> {
  return db.transaction('rw', db.records, async () => {
    const old = await db.records.get(id);
    if (!old || old.voidedAt) throw new AppError('NOT_FOUND');
    const u = unit ?? old.unit;
    const q = validateQty(qty, u);
    const rec: CountRecord = {
      id: uid(),
      sessionId: old.sessionId,
      locationId: old.locationId,
      productId: old.productId,
      qty: q,
      unit: u,
      createdAt: Date.now(),
      supersedes: old.id,
    };
    await db.records.add(rec);
    await db.records.update(old.id, { voidedAt: Date.now(), supersededBy: rec.id });
    return rec;
  });
}

/** Undo the most recent operation of a session. Undoing a correction reverts to the previous value. */
export async function undoLast(sessionId: string): Promise<CountRecord | undefined> {
  return db.transaction('rw', db.records, async () => {
    const live = await db.records.where('sessionId').equals(sessionId).filter((r) => !r.voidedAt).toArray();
    if (!live.length) return undefined;
    const last = live.reduce((a, b) => (b.createdAt >= a.createdAt ? b : a));
    await db.records.update(last.id, { voidedAt: Date.now() });
    if (last.supersedes) {
      const prev = await db.records.get(last.supersedes);
      if (prev) await db.records.put({ ...prev, voidedAt: undefined, supersededBy: undefined });
    }
    return last;
  });
}

/** Totals per unit. Units are never silently mixed. */
export function sumByUnit(records: CountRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of records) {
    if (r.voidedAt) continue;
    out[r.unit] = Math.round(((out[r.unit] ?? 0) + r.qty) * 1000) / 1000;
  }
  return out;
}

export function fmtTotals(totals: Record<string, number>, unitLabel: (u: string) => string): string {
  const parts = Object.entries(totals).map(([u, q]) => `${fmtNum(q)} ${unitLabel(u)}`);
  return parts.length ? parts.join(' · ') : '0';
}

/** Extra information when a carton conversion is configured. */
export function pieceEquivalent(product: Product | undefined, unit: Unit, qty: number): number | undefined {
  if (!product?.cartonQty || unit !== 'carton') return undefined;
  return qty * product.cartonQty;
}
