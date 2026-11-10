import { db } from '../db';
import { addRecord, correctRecord, sumByUnit, undoLast } from './records';
import { addLocation } from './locations';
import { createProduct, findProductByCode, mergeProducts } from './products';
import { buildBackup, validateBackup } from './backup';
import { buildXlsx } from './io';
import { inventoryRows } from './reports';
import { uid } from './util';

export interface TestStep {
  name: string;
  ok: boolean;
  detail?: string;
}

/**
 * Runs the core workflow against the real IndexedDB using throw-away data, then removes it.
 * It never touches existing user data (own session, own products).
 * Reopen-the-app persistence and a real JSON *restore* are intentionally not automated here
 * because a restore replaces all data — test those by hand (see README).
 */
export async function runSelfTest(): Promise<TestStep[]> {
  const steps: TestStep[] = [];
  const check = (name: string, cond: boolean, detail?: string) => steps.push({ name, ok: cond, detail });
  const tag = 'SELFTEST-' + uid().slice(0, 6).toUpperCase();
  const sessionId = uid();
  const createdProducts: string[] = [];
  const bc = '6190000' + String(Date.now()).slice(-6);

  try {
    await db.sessions.add({ id: sessionId, name: tag, date: '2000-01-01', warehouse: 'TEST', status: 'active', demo: true, createdAt: Date.now() });
    check('1. Create a session', !!(await db.sessions.get(sessionId)));

    const locA = await addLocation(sessionId, 'Zone A', 'Rayon 01');
    const locB = await addLocation(sessionId, 'Zone B', 'Rayon 01');
    check('2. Create locations', locA.id !== locB.id);

    const p = await createProduct({ reference: tag + '-A', barcode: bc, name: 'Test product', unit: 'piece', cartonQty: 20, photoIds: [] });
    createdProducts.push(p.id);
    check('3-4. Unknown barcode → new product, then found by barcode', (await findProductByCode(bc))?.id === p.id);

    let dupBlocked = false;
    try {
      await createProduct({ barcode: bc, name: 'dup', unit: 'piece', photoIds: [] });
    } catch (e: any) {
      dupBlocked = e?.code === 'DUP_BARCODE';
    }
    check('7. Same barcode never creates a second product', dupBlocked);

    const t1 = await createProduct({ name: 'Unknown 1', unit: 'piece', photoIds: [] });
    const t2 = await createProduct({ name: 'Unknown 2', unit: 'piece', photoIds: [] });
    createdProducts.push(t1.id, t2.id);
    check('5. Unknown products get unique TMP references', t1.isTemp && t2.isTemp && t1.reference !== t2.reference, `${t1.reference}, ${t2.reference}`);

    await addRecord({ sessionId, locationId: locA.id, productId: p.id, qty: 10, unit: 'piece' });
    await addRecord({ sessionId, locationId: locA.id, productId: p.id, qty: 5, unit: 'piece' });
    await addRecord({ sessionId, locationId: locB.id, productId: p.id, qty: 7, unit: 'piece' });
    await addRecord({ sessionId, locationId: locA.id, productId: p.id, qty: 3, unit: 'carton' });
    const all = await db.records.where('sessionId').equals(sessionId).toArray();
    const atA = sumByUnit(all.filter((r) => r.locationId === locA.id));
    const atB = sumByUnit(all.filter((r) => r.locationId === locB.id));
    check('6/8. Quantities accumulate per location, units are not mixed', atA.piece === 15 && atA.carton === 3 && atB.piece === 7, JSON.stringify({ atA, atB }));

    const last = await undoLast(sessionId);
    const afterUndo = sumByUnit(await db.records.where('sessionId').equals(sessionId).toArray());
    check('Undo last operation keeps the record but excludes it', !!last && !!(await db.records.get(last.id))?.voidedAt && afterUndo.carton === undefined);

    const rec = (await db.records.where('sessionId').equals(sessionId).filter((r) => !r.voidedAt && r.qty === 10).first())!;
    await correctRecord(rec.id, 12);
    const hist = await db.records.where('sessionId').equals(sessionId).toArray();
    check('Correction preserves the previous record', hist.some((r) => r.id === rec.id && !!r.voidedAt) && sumByUnit(hist).piece === 24, String(sumByUnit(hist).piece));

    await mergeProducts(p.id, t1.id);
    check('Merge keeps the merged product, nothing deleted', !!(await db.products.get(t1.id))?.mergedInto);

    const rows = await inventoryRows({ sessionId, lang: 'fr', unitLabel: (u) => u });
    const xlsx = await buildXlsx([{ name: 'Inventaire', rows }]);
    check('11. Excel export builds a non-empty .xlsx', rows.length >= 2 && xlsx.size > 1000, `${rows.length} rows, ${xlsx.size} bytes`);

    const backup = await buildBackup(false);
    const v = validateBackup(JSON.stringify(backup));
    check('12. Backup serialises and passes validation (restore itself: manual test)', v.ok, v.errors.join(','));
    const broken = validateBackup(JSON.stringify({ ...backup, tables: { ...backup.tables, records: [{ id: 'x', qty: 1, productId: 'nope', locationId: 'nope', sessionId: 'nope' }] } }));
    check('Corrupt backups are rejected before restoring', !broken.ok);
  } catch (e: any) {
    check('Unexpected error', false, String(e?.message ?? e));
  } finally {
    try {
      await db.records.where('sessionId').equals(sessionId).delete();
      await db.locations.where('sessionId').equals(sessionId).delete();
      await db.sessions.delete(sessionId);
      await db.products.bulkDelete(createdProducts);
    } catch {
      /* best effort */
    }
  }
  return steps;
}
