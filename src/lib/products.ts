import { db } from '../db';
import type { BarcodeItem, Product, Unit } from '../types';
import { norm, uid } from './util';
import { nextInternalBarcodeInTx } from './barcodes';

export type ErrorCode =
  | 'DUP_REF'
  | 'DUP_BARCODE'
  | 'BAD_REF'
  | 'BAD_BARCODE'
  | 'BAD_CARTON'
  | 'NOT_FOUND'
  | 'BAD_QTY'
  | 'BAD_MERGE';

export class AppError extends Error {
  code: ErrorCode;
  existingId?: string;
  constructor(code: ErrorCode, existingId?: string) {
    super(code);
    this.code = code;
    this.existingId = existingId;
  }
}

/** Letters/digits first, then letters, digits, space and - _ . / # + */
const REF_RE = /^[\p{L}\p{N}][\p{L}\p{N} \-_./#+]{0,63}$/u;
const BC_RE = /^\S{3,128}$/;
const TMP_RE = /^TMP-\d{4,}$/i;

export const isTmpRef = (s?: string) => !!s && TMP_RE.test(s.trim());
export const refKeyOf = (s?: string): string | undefined => {
  const v = norm(s).toUpperCase();
  return v || undefined;
};

export interface ProductInput {
  reference?: string;
  barcode?: string;
  originalBarcode?: string;
  name?: string;
  description?: string;
  category?: string;
  unit: Unit;
  cartonQty?: number | null;
  minStock?: number | null;
  photoIds: string[];
}

function validate(inp: ProductInput, currentRef?: string) {
  const ref = norm(inp.reference);
  const bc = norm(inp.barcode || inp.originalBarcode);
  if (ref && (!REF_RE.test(ref) || (isTmpRef(ref) && ref.toUpperCase() !== (currentRef ?? '').toUpperCase()))) {
    throw new AppError('BAD_REF');
  }
  if (bc && !BC_RE.test(bc)) throw new AppError('BAD_BARCODE');
  if (inp.cartonQty != null) {
    const c = inp.cartonQty;
    if (!Number.isFinite(c) || !Number.isInteger(c) || c < 1 || c > 100000) throw new AppError('BAD_CARTON');
  }
}

async function byRef(ref: string): Promise<Product | undefined> {
  const k = refKeyOf(ref)!;
  return (await db.products.where('refKey').equals(k).first()) ?? (await db.products.where('aliases').equals(k).first());
}
async function byBarcode(bc: string): Promise<Product | undefined> {
  return (
    (await db.products.where('barcode').equals(bc).first()) ??
    (await db.products.where('internalBarcode').equals(bc).first()) ??
    (await db.products.where('aliases').equals(bc).first()) ??
    (await db.products.filter((p) => p.originalBarcode === bc || (p.barcodes ?? []).some((b) => b.code === bc && b.status === 'active')).first())
  );
}

async function assertUnique(ref: string | undefined, bc: string | undefined, selfId?: string) {
  if (ref) {
    const hit = await byRef(ref);
    if (hit && hit.id !== selfId) throw new AppError('DUP_REF', hit.id);
  }
  if (bc) {
    const hit = await byBarcode(bc);
    if (hit && hit.id !== selfId) throw new AppError('DUP_BARCODE', hit.id);
  }
}

/** Must be called inside a transaction that includes db.meta and db.products. */
async function nextTmpRefInTx(): Promise<string> {
  let n = ((await db.meta.get('tmpCounter'))?.value as number | undefined) ?? 0;
  for (;;) {
    n += 1;
    const ref = 'TMP-' + String(n).padStart(4, '0');
    const clash = await db.products.where('refKey').equals(ref).first();
    const clashAlias = await db.products.where('aliases').equals(ref).first();
    if (!clash && !clashAlias) {
      await db.meta.put({ key: 'tmpCounter', value: n });
      return ref;
    }
  }
}

export const nextTmpRef = () => db.transaction('rw', db.meta, db.products, nextTmpRefInTx);

export async function createProduct(inp: ProductInput): Promise<Product> {
  validate(inp);
  return db.transaction('rw', db.products, db.meta, async () => {
    let reference = norm(inp.reference) || undefined;
    const originalBarcode = norm(inp.originalBarcode || inp.barcode) || undefined;
    await assertUnique(reference, originalBarcode);
    let isTemp = false;
    if (!reference && !originalBarcode) {
      reference = await nextTmpRefInTx();
      isTemp = true;
    }

    // Every product gets an automatic permanent internal Code 128 barcode identity
    const internalBarcode = await nextInternalBarcodeInTx();
    const now = Date.now();
    const barcodes: BarcodeItem[] = [
      {
        code: internalBarcode,
        type: 'internal',
        createdAt: now,
        status: 'active',
      },
    ];
    if (originalBarcode) {
      barcodes.push({
        code: originalBarcode,
        type: 'original',
        createdAt: now,
        status: 'active',
      });
    }

    const aliases = new Set<string>();
    aliases.add(internalBarcode);
    if (originalBarcode) aliases.add(originalBarcode);

    const p: Product = {
      id: uid(),
      reference,
      refKey: refKeyOf(reference),
      barcode: originalBarcode || internalBarcode,
      originalBarcode,
      internalBarcode,
      barcodes,
      minStock: inp.minStock != null ? inp.minStock : undefined,
      name: norm(inp.name) || reference || originalBarcode || internalBarcode || '—',
      description: norm(inp.description) || undefined,
      category: norm(inp.category) || undefined,
      photoIds: inp.photoIds ?? [],
      unit: inp.unit,
      cartonQty: inp.cartonQty ?? undefined,
      isTemp,
      aliases: Array.from(aliases),
      createdAt: now,
      updatedAt: now,
    };
    await db.products.add(p);
    return p;
  });
}

export async function updateProduct(id: string, inp: ProductInput): Promise<Product> {
  return db.transaction('rw', db.products, db.meta, async () => {
    const cur = await db.products.get(id);
    if (!cur) throw new AppError('NOT_FOUND');
    validate(inp, cur.isTemp ? cur.reference : undefined);
    let reference = norm(inp.reference) || undefined;
    const barcodeInput = norm(inp.barcode || inp.originalBarcode) || undefined;

    // Never generate a new internalBarcode if one already exists
    const internalBarcode = cur.internalBarcode || (await nextInternalBarcodeInTx());

    let originalBarcode = cur.originalBarcode;
    if (barcodeInput && barcodeInput !== internalBarcode && barcodeInput !== cur.originalBarcode && barcodeInput !== cur.barcode) {
      await assertUnique(reference, barcodeInput, id);
      originalBarcode = barcodeInput;
    } else {
      await assertUnique(reference, undefined, id);
    }

    const aliases = new Set<string>(cur.aliases ?? []);
    aliases.add(internalBarcode);
    if (originalBarcode) aliases.add(originalBarcode);

    let isTemp: boolean;
    if (!reference && !originalBarcode) {
      // nothing identifies the product any more: keep/regenerate a temporary reference
      reference = cur.isTemp && cur.reference ? cur.reference : await nextTmpRefInTx();
      isTemp = true;
    } else {
      isTemp = cur.isTemp && !originalBarcode && reference?.toUpperCase() === cur.reference?.toUpperCase();
      if (cur.isTemp && !isTemp && cur.reference && cur.reference.toUpperCase() !== reference?.toUpperCase()) {
        aliases.add(cur.reference.toUpperCase());
      }
    }

    const barcodes = [...(cur.barcodes ?? [])];
    if (!barcodes.some((b) => b.type === 'internal')) {
      barcodes.unshift({ code: internalBarcode, type: 'internal', createdAt: cur.createdAt || Date.now(), status: 'active' });
    }
    if (originalBarcode && !barcodes.some((b) => b.code === originalBarcode)) {
      barcodes.push({ code: originalBarcode, type: 'original', createdAt: Date.now(), status: 'active' });
    }

    const next: Product = {
      ...cur,
      reference,
      refKey: refKeyOf(reference),
      barcode: originalBarcode || cur.barcode || internalBarcode,
      originalBarcode,
      internalBarcode,
      barcodes,
      minStock: inp.minStock !== undefined ? (inp.minStock != null ? inp.minStock : undefined) : cur.minStock,
      name: norm(inp.name) || reference || originalBarcode || internalBarcode || cur.name,
      description: norm(inp.description) || undefined,
      category: norm(inp.category) || undefined,
      photoIds: inp.photoIds ?? cur.photoIds,
      unit: inp.unit,
      cartonQty: inp.cartonQty ?? undefined,
      isTemp,
      aliases: Array.from(aliases),
      updatedAt: Date.now(),
    };
    await db.products.put(next);
    return next;
  });
}

const codeVariants = (c: string): string[] => {
  const out = [c];
  // UPC-A (12) is reported as EAN-13 with a leading 0 by some decoders
  if (/^\d{13}$/.test(c) && c.startsWith('0')) out.push(c.slice(1));
  if (/^\d{12}$/.test(c)) out.push('0' + c);
  return out;
};

/** Identify a scanned/typed code by barcode, internal barcode, original barcode, reference or alias. Merged products are never returned. */
export async function findProductByCode(code: string): Promise<Product | undefined> {
  const c = norm(code);
  if (!c) return undefined;
  for (const v of codeVariants(c)) {
    const k = v.toUpperCase();
    const p =
      (await db.products.where('barcode').equals(v).first()) ??
      (await db.products.where('internalBarcode').equals(v).first()) ??
      (await db.products.where('refKey').equals(k).first()) ??
      (await db.products.where('aliases').anyOf([v, k]).first()) ??
      (await db.products.filter((prod) => !prod.mergedInto && (prod.originalBarcode === v || (prod.barcodes ?? []).some((b) => b.code === v && b.status === 'active'))).first());
    if (p && !p.mergedInto) return p;
  }
  return undefined;
}

/**
 * Merge `dropId` into `keepId`. Nothing is deleted: the merged product stays in the
 * database flagged `mergedInto`, its counting records are re-pointed (keeping `fromProductId`),
 * and its codes become aliases of the surviving product.
 */
export async function mergeProducts(keepId: string, dropId: string): Promise<void> {
  if (keepId === dropId) throw new AppError('BAD_MERGE');
  await db.transaction('rw', db.products, db.records, async () => {
    const keep = await db.products.get(keepId);
    const drop = await db.products.get(dropId);
    if (!keep || !drop || keep.mergedInto || drop.mergedInto) throw new AppError('BAD_MERGE');
    const aliases = new Set<string>([...(keep.aliases ?? []), ...(drop.aliases ?? [])]);
    if (drop.barcode) aliases.add(drop.barcode);
    if (drop.reference) aliases.add(drop.reference.toUpperCase());
    // never alias a code that is the survivor's own primary code
    if (keep.barcode) aliases.delete(keep.barcode);
    if (keep.refKey) aliases.delete(keep.refKey);

    const recs = await db.records.where('productId').equals(dropId).toArray();
    for (const r of recs) await db.records.put({ ...r, productId: keepId, fromProductId: dropId });

    const now = Date.now();
    await db.products.put({
      ...drop,
      refKey: undefined,
      barcode: undefined,
      aliases: [],
      mergedInto: keepId,
      updatedAt: now,
    });
    await db.products.put({
      ...keep,
      aliases: Array.from(aliases),
      photoIds: Array.from(new Set([...keep.photoIds, ...drop.photoIds])),
      description: keep.description ?? drop.description,
      category: keep.category ?? drop.category,
      updatedAt: now,
    });
  });
}
