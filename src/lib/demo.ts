import { db } from '../db';
import type { CountRecord, Loc, Product, Session, Unit } from '../types';
import { todayISO, uid } from './util';

/** EAN-13 with a valid check digit so scanning a printed demo barcode works. */
function ean13(body12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body12[i]) * (i % 2 === 0 ? 1 : 3);
  return body12 + ((10 - (sum % 10)) % 10);
}

const DEMO_PRODUCTS: { ref: string; body: string; name: string; cat: string; unit: Unit; carton?: number }[] = [
  { ref: 'DEMO-VIS-M8', body: '619000000101', name: 'Vis M8 x 40 (DEMO)', cat: 'Visserie', unit: 'piece', carton: 200 },
  { ref: 'DEMO-ECR-M8', body: '619000000102', name: 'Écrou M8 (DEMO)', cat: 'Visserie', unit: 'piece', carton: 500 },
  { ref: 'DEMO-GANT-L', body: '619000000103', name: 'Gants de manutention L (DEMO)', cat: 'EPI', unit: 'piece', carton: 12 },
  { ref: 'DEMO-CASQ-B', body: '619000000104', name: 'Casque de chantier blanc (DEMO)', cat: 'EPI', unit: 'piece', carton: 10 },
  { ref: 'DEMO-CABLE-3G15', body: '619000000105', name: 'Câble 3G1.5 mm² (DEMO)', cat: 'Électricité', unit: 'meter' },
  { ref: 'DEMO-PEINT-W10', body: '619000000106', name: 'Peinture blanche 10 L (DEMO)', cat: 'Peinture', unit: 'piece', carton: 4 },
  { ref: 'DEMO-COLLE-500', body: '619000000107', name: 'Colle PVC 500 g (DEMO)', cat: 'Plomberie', unit: 'piece', carton: 24 },
  { ref: 'DEMO-TUBE-32', body: '619000000108', name: 'Tube PVC Ø32 (DEMO)', cat: 'Plomberie', unit: 'piece' },
  { ref: 'DEMO-RUBAN-48', body: '619000000109', name: 'Ruban adhésif 48 mm (DEMO)', cat: 'Emballage', unit: 'box', carton: 36 },
  { ref: 'DEMO-SAC-25', body: '619000000110', name: 'Ciment 25 kg (DEMO)', cat: 'Matériaux', unit: 'piece' },
];

export interface DemoIds {
  sessionId: string;
  locationId: string;
}

export async function loadDemo(): Promise<DemoIds> {
  const now = Date.now();
  const session: Session = { id: uid(), name: 'Inventaire DEMO', date: todayISO(), warehouse: 'Entrepôt DEMO', notes: 'Données de démonstration', status: 'active', demo: true, createdAt: now };
  const locs: Loc[] = [
    { zone: 'Zone A', shelf: 'Rayon 01' },
    { zone: 'Zone A', shelf: 'Rayon 02' },
    { zone: 'Zone B', shelf: 'Rayon 01' },
  ].map((l) => ({ id: uid(), sessionId: session.id, completed: false, demo: true, createdAt: now, ...l }));

  const products: Product[] = [];
  const newProducts: Product[] = [];
  for (const d of DEMO_PRODUCTS) {
    const already = await db.products.where('refKey').equals(d.ref).first();
    if (already) {
      products.push(already); // reuse demo products from a previous load
      continue;
    }
    const created: Product = {
      id: uid(),
      reference: d.ref,
      refKey: d.ref,
      barcode: ean13(d.body),
      name: d.name,
      category: d.cat,
      photoIds: [],
      unit: d.unit,
      cartonQty: d.carton,
      isTemp: false,
      aliases: [],
      demo: true,
      createdAt: now,
      updatedAt: now,
    };
    products.push(created);
    newProducts.push(created);
  }
  const recs: CountRecord[] = [
    [0, 0, 'piece', 120],
    [0, 0, 'carton', 3],
    [1, 0, 'piece', 480],
    [2, 1, 'piece', 36],
    [4, 2, 'meter', 85.5],
    [5, 2, 'piece', 14],
  ].map(([pi, li, unit, qty], i) => ({
    id: uid(),
    sessionId: session.id,
    locationId: locs[li as number].id,
    productId: products[pi as number].id,
    qty: qty as number,
    unit: unit as Unit,
    createdAt: now + i,
    demo: true,
  }));

  await db.transaction('rw', [db.sessions, db.locations, db.products, db.records], async () => {
    await db.sessions.add(session);
    await db.locations.bulkAdd(locs);
    if (newProducts.length) await db.products.bulkAdd(newProducts);
    await db.records.bulkAdd(recs);
  });
  return { sessionId: session.id, locationId: locs[0].id };
}

/** Removes demo data only. Refuses when real (non-demo) counts point at demo items. */
export async function removeDemo(): Promise<{ ok: boolean; blockedBy?: number }> {
  return db.transaction('rw', [db.sessions, db.locations, db.products, db.records], async () => {
    const demoProducts = await db.products.filter((p) => !!p.demo).primaryKeys();
    const demoLocs = await db.locations.filter((l) => !!l.demo).primaryKeys();
    const demoSessions = await db.sessions.filter((s) => !!s.demo).primaryKeys();
    const pset = new Set(demoProducts);
    const lset = new Set(demoLocs);
    const sset = new Set(demoSessions);
    const real = await db.records
      .filter((r) => !r.demo && (pset.has(r.productId) || lset.has(r.locationId) || sset.has(r.sessionId)))
      .count();
    if (real > 0) return { ok: false, blockedBy: real };
    await db.records.filter((r) => !!r.demo).delete();
    await db.locations.bulkDelete(demoLocs);
    await db.sessions.bulkDelete(demoSessions);
    await db.products.bulkDelete(demoProducts);
    return { ok: true };
  });
}
