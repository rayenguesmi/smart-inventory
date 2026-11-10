import { db } from '../db';
import type { BarcodeItem, BarcodeType, Product } from '../types';
import { norm } from './util';
import { AppError } from './products';

/**
 * Sequential counter for internal barcodes (INV-000001, INV-000002, ...).
 * Must be executed in a transaction covering db.meta and db.products.
 */
export async function nextInternalBarcodeInTx(): Promise<string> {
  let counter = ((await db.meta.get('internalBarcodeCounter'))?.value as number | undefined) ?? 0;
  for (;;) {
    counter += 1;
    const code = 'INV-' + String(counter).padStart(6, '0');
    // Ensure no collision with any existing product
    const clashInternal = await db.products.where('internalBarcode').equals(code).first();
    const clashLegacy = await db.products.where('barcode').equals(code).first();
    const clashAlias = await db.products.where('aliases').equals(code).first();
    if (!clashInternal && !clashLegacy && !clashAlias) {
      await db.meta.put({ key: 'internalBarcodeCounter', value: counter });
      return code;
    }
  }
}

/**
 * Asserts that a barcode is not already assigned to another product.
 * Checks across:
 * - barcode
 * - internalBarcode
 * - originalBarcode
 * - aliases
 */
export async function assertBarcodeUnique(code: string, selfId?: string): Promise<void> {
  const c = norm(code);
  if (!c) return;

  const hitBc = await db.products.where('barcode').equals(c).first();
  if (hitBc && hitBc.id !== selfId) throw new AppError('DUP_BARCODE', hitBc.id);

  const hitInternal = await db.products.where('internalBarcode').equals(c).first();
  if (hitInternal && hitInternal.id !== selfId) throw new AppError('DUP_BARCODE', hitInternal.id);

  const hitAlias = await db.products.where('aliases').equals(c).first();
  if (hitAlias && hitAlias.id !== selfId) throw new AppError('DUP_BARCODE', hitAlias.id);

  // Also check originalBarcode by scanning if index is populated or filtering
  const hitOrig = await db.products.filter((p) => p.originalBarcode === c && p.id !== selfId).first();
  if (hitOrig) throw new AppError('DUP_BARCODE', hitOrig.id);

  // Check structured barcodes array if present
  const hitArray = await db.products.filter((p) => (p.barcodes ?? []).some((b) => b.code === c && b.status === 'active') && p.id !== selfId).first();
  if (hitArray) throw new AppError('DUP_BARCODE', hitArray.id);
}

/**
 * Ensures that EVERY registered product has a permanent unique internal barcode (INV-000001, ...).
 * If a product lacks one, generates it sequentially, preserves existing data, and persists it.
 * Never alters an existing product's internalBarcode once assigned.
 */
export async function ensureAllProductsHaveInternalBarcode(): Promise<number> {
  const missing = await db.products.filter((p) => !p.internalBarcode && !p.mergedInto).toArray();
  if (!missing.length) return 0;

  let assignedCount = 0;
  await db.transaction('rw', db.products, db.meta, async () => {
    for (const p of missing) {
      // Re-check inside transaction
      const cur = await db.products.get(p.id);
      if (!cur || cur.internalBarcode) continue;

      const internalBarcode = await nextInternalBarcodeInTx();
      const now = Date.now();
      const existingBarcodes = [...(cur.barcodes ?? [])];

      // If product has a legacy barcode that is not an internal code, treat it as original
      const origBc = cur.originalBarcode || (cur.barcode && !cur.barcode.startsWith('INV-') ? cur.barcode : undefined);

      if (!existingBarcodes.some((b) => b.type === 'internal')) {
        existingBarcodes.unshift({
          code: internalBarcode,
          type: 'internal',
          createdAt: cur.createdAt || now,
          status: 'active',
        });
      }
      if (origBc && !existingBarcodes.some((b) => b.code === origBc)) {
        existingBarcodes.push({
          code: origBc,
          type: 'original',
          createdAt: cur.createdAt || now,
          status: 'active',
        });
      }

      const aliases = new Set<string>(cur.aliases ?? []);
      aliases.add(internalBarcode);
      if (origBc) aliases.add(origBc);

      const updated: Product = {
        ...cur,
        internalBarcode,
        originalBarcode: origBc,
        barcode: cur.barcode || origBc || internalBarcode,
        barcodes: existingBarcodes,
        aliases: Array.from(aliases),
        updatedAt: now,
      };

      await db.products.put(updated);
      assignedCount++;
    }
  });

  return assignedCount;
}

/**
 * Adds an associated barcode to an existing product with duplicate prevention.
 */
export async function addAssociatedBarcode(
  productId: string,
  code: string,
  type: BarcodeType = 'secondary'
): Promise<Product> {
  const c = norm(code);
  if (!c) throw new AppError('BAD_BARCODE');

  await assertBarcodeUnique(c, productId);

  return db.transaction('rw', db.products, async () => {
    const cur = await db.products.get(productId);
    if (!cur) throw new AppError('NOT_FOUND');

    const barcodes = [...(cur.barcodes ?? [])];
    const existingIdx = barcodes.findIndex((b) => b.code === c);

    if (existingIdx >= 0) {
      barcodes[existingIdx] = { ...barcodes[existingIdx], status: 'active', type };
    } else {
      barcodes.push({
        code: c,
        type,
        createdAt: Date.now(),
        status: 'active',
      });
    }

    const aliases = new Set<string>(cur.aliases ?? []);
    aliases.add(c);

    const updated: Product = {
      ...cur,
      barcodes,
      aliases: Array.from(aliases),
      updatedAt: Date.now(),
    };

    await db.products.put(updated);
    return updated;
  });
}

/**
 * Retires or removes an associated barcode from a product.
 * Protects permanent internal barcodes from removal.
 */
export async function removeAssociatedBarcode(productId: string, code: string): Promise<Product> {
  const c = norm(code);
  return db.transaction('rw', db.products, async () => {
    const cur = await db.products.get(productId);
    if (!cur) throw new AppError('NOT_FOUND');

    if (cur.internalBarcode === c) {
      throw new Error('CANNOT_REMOVE_INTERNAL_BARCODE');
    }

    const barcodes = (cur.barcodes ?? []).filter((b) => b.code !== c);
    const aliases = (cur.aliases ?? []).filter((a) => a !== c);

    const updated: Product = {
      ...cur,
      barcodes,
      aliases,
      // If the primary barcode was the removed one, fallback to original or internal
      barcode: cur.barcode === c ? cur.originalBarcode || cur.internalBarcode : cur.barcode,
      originalBarcode: cur.originalBarcode === c ? undefined : cur.originalBarcode,
      updatedAt: Date.now(),
    };

    await db.products.put(updated);
    return updated;
  });
}

