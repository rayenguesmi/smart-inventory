import { db } from '../db';
import type { Product, Unit } from '../types';
import { UNITS } from '../types';
import { isTmpRef, refKeyOf } from './products';
import { norm, uid } from './util';

export const IMPORT_FIELDS = ['reference', 'barcode', 'name', 'description', 'category', 'unit', 'cartonQty'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type Mapping = Record<ImportField, number>; // column index, -1 = not mapped

const GUESS: Record<ImportField, RegExp> = {
  reference: /^(r[ée]f|r[ée]f[ée]rence|sku|article|code\s*art|item|part|مرجع)/i,
  barcode: /(ean|barcode|code[\s_-]*barre|gtin|upc|باركود)/i,
  name: /(name|nom|d[ée]signation|designation|libell|produit|product|description courte|اسم|المنتج)/i,
  description: /(description|d[ée]tail|desc)/i,
  category: /(cat[ée]gor|famille|family|type|فئة)/i,
  unit: /(unit[ée]?|uom|وحدة)/i,
  cartonQty: /(carton|colisage|pcb|per\s*box|par\s*carton)/i,
};

export function guessMapping(headers: string[]): Mapping {
  const m = Object.fromEntries(IMPORT_FIELDS.map((f) => [f, -1])) as Mapping;
  const used = new Set<number>();
  // barcode first so "code barre" is not taken by the reference rule
  const order: ImportField[] = ['barcode', 'reference', 'name', 'cartonQty', 'unit', 'category', 'description'];
  for (const f of order) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && GUESS[f].test(h));
    if (i >= 0) {
      m[f] = i;
      used.add(i);
    }
  }
  return m;
}

export function parseUnit(s: string): Unit {
  const v = s.trim().toLowerCase();
  if (!v) return 'piece';
  if (/^(carton|ctn|cart)/.test(v)) return 'carton';
  if (/^(bo[iî]te|box|bte)/.test(v)) return 'box';
  if (/^(kg|kilo)/.test(v)) return 'kg';
  if (/^(m|mètre|metre|meter|mt)$/.test(v)) return 'meter';
  return (UNITS as string[]).includes(v) ? (v as Unit) : 'piece';
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}

const REF_RE = /^[\p{L}\p{N}][\p{L}\p{N} \-_./#+]{0,63}$/u;
const BC_RE = /^\S{3,128}$/;

/**
 * rows[0] is the header row. mode 'skip' leaves existing products untouched,
 * 'fill' only fills fields that are empty on the existing product.
 */
export async function importProducts(rows: string[][], map: Mapping, mode: 'skip' | 'fill', onProgress?: (n: number, total: number) => void): Promise<ImportResult> {
  const res: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] };
  const existing = await db.products.filter((p) => !p.mergedInto).toArray();
  const byRef = new Map<string, Product>();
  const byBc = new Map<string, Product>();
  for (const p of existing) {
    if (p.refKey) byRef.set(p.refKey, p);
    if (p.barcode) byBc.set(p.barcode, p);
    for (const a of p.aliases ?? []) {
      byRef.set(a.toUpperCase(), p);
      byBc.set(a, p);
    }
  }
  const cell = (r: string[], f: ImportField) => (map[f] >= 0 ? norm(r[map[f]]) : '');
  const toAdd: Product[] = [];
  const toPut = new Map<string, Product>();
  const now = Date.now();

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const reference = cell(r, 'reference');
    const barcode = cell(r, 'barcode');
    const name = cell(r, 'name');
    if (!reference && !barcode && !name) {
      res.skipped++;
      continue;
    }
    if (reference && (!REF_RE.test(reference) || isTmpRef(reference))) {
      res.errors.push({ row: i + 1, reason: 'BAD_REF' });
      continue;
    }
    if (barcode && !BC_RE.test(barcode)) {
      res.errors.push({ row: i + 1, reason: 'BAD_BARCODE' });
      continue;
    }
    if (!reference && !barcode) {
      // a bare name is not a reliable identity: refuse instead of guessing
      res.errors.push({ row: i + 1, reason: 'NO_ID' });
      continue;
    }
    const cq = cell(r, 'cartonQty');
    const cartonQty = cq && Number.isInteger(Number(cq)) && Number(cq) >= 1 ? Number(cq) : undefined;
    const hitB = barcode ? byBc.get(barcode) : undefined;
    const hitR = reference ? byRef.get(refKeyOf(reference)!) : undefined;
    if (hitB && hitR && hitB.id !== hitR.id) {
      res.errors.push({ row: i + 1, reason: 'CONFLICT' });
      continue;
    }
    const hit = hitB ?? hitR;
    if (hit) {
      if (mode === 'skip') {
        res.skipped++;
        continue;
      }
      const cur = toPut.get(hit.id) ?? hit;
      const next: Product = { ...cur };
      let changed = false;
      const fill = <K extends keyof Product>(k: K, v: Product[K] | undefined) => {
        if (v !== undefined && v !== '' && !next[k]) {
          next[k] = v as Product[K];
          changed = true;
        }
      };
      if (barcode && !next.barcode && !byBc.has(barcode)) {
        next.barcode = barcode;
        byBc.set(barcode, next);
        changed = true;
      }
      if (reference && !next.reference) {
        next.reference = reference;
        next.refKey = refKeyOf(reference);
        next.isTemp = false;
        byRef.set(next.refKey!, next);
        changed = true;
      }
      fill('description', cell(r, 'description') || undefined);
      fill('category', cell(r, 'category') || undefined);
      fill('cartonQty', cartonQty);
      if (changed) {
        next.updatedAt = now;
        toPut.set(next.id, next);
        res.updated++;
      } else res.skipped++;
      continue;
    }
    const p: Product = {
      id: uid(),
      reference: reference || undefined,
      refKey: refKeyOf(reference),
      barcode: barcode || undefined,
      name: name || reference || barcode,
      description: cell(r, 'description') || undefined,
      category: cell(r, 'category') || undefined,
      photoIds: [],
      unit: parseUnit(cell(r, 'unit')),
      cartonQty,
      isTemp: false,
      aliases: [],
      createdAt: now,
      updatedAt: now,
    };
    if (p.refKey) byRef.set(p.refKey, p);
    if (p.barcode) byBc.set(p.barcode, p);
    toAdd.push(p);
    res.created++;
  }

  const CHUNK = 500;
  for (let i = 0; i < toAdd.length; i += CHUNK) {
    await db.products.bulkAdd(toAdd.slice(i, i + CHUNK));
    onProgress?.(Math.min(i + CHUNK, toAdd.length), toAdd.length);
  }
  if (toPut.size) await db.products.bulkPut([...toPut.values()]);
  return res;
}
