import JSZip from 'jszip';
import { db } from '../db';
import type { Lang, Loc, Product } from '../types';
import { fmtDateTime, fmtNum, sanitizeFile, saveBlob, stamp } from './util';
import { locName, sortLocs } from './locations';
import { sumByUnit } from './records';
import { buildXlsx, downloadCsv, downloadXlsx, rowsToCsv, type Row } from './io';

type UnitLabel = (u: string) => string;

interface Ctx {
  sessionId: string;
  lang: Lang;
  unitLabel: UnitLabel;
}

async function load(sessionId: string) {
  const [session, locations, records] = await Promise.all([
    db.sessions.get(sessionId),
    db.locations.where('sessionId').equals(sessionId).toArray(),
    db.records.where('sessionId').equals(sessionId).toArray(),
  ]);
  const ids = [...new Set(records.map((r) => r.productId))];
  const products = new Map<string, Product>();
  (await db.products.bulkGet(ids)).forEach((p) => p && products.set(p.id, p));
  return { session, locations: locations.sort(sortLocs), records, products, locMap: new Map(locations.map((l) => [l.id, l])) };
}

/** One line per product × location × unit (active records only). */
export async function inventoryRows(c: Ctx): Promise<Row[]> {
  const { session, records, products, locMap } = await load(c.sessionId);
  const groups = new Map<string, { loc?: Loc; p?: Product; unit: string; qty: number; n: number; last: number }>();
  for (const r of records) {
    if (r.voidedAt) continue;
    const key = `${r.locationId}|${r.productId}|${r.unit}`;
    const g = groups.get(key) ?? { loc: locMap.get(r.locationId), p: products.get(r.productId), unit: r.unit, qty: 0, n: 0, last: 0 };
    g.qty = Math.round((g.qty + r.qty) * 1000) / 1000;
    g.n += 1;
    g.last = Math.max(g.last, r.createdAt);
    groups.set(key, g);
  }
  return [...groups.values()]
    .sort((a, b) => (a.loc && b.loc ? sortLocs(a.loc, b.loc) : 0) || (a.p?.name ?? '').localeCompare(b.p?.name ?? ''))
    .map((g) => ({
      Inventaire: session?.name ?? '',
      Entrepôt: session?.warehouse ?? '',
      Zone: g.loc?.zone ?? '',
      Rayon: g.loc?.shelf ?? '',
      Référence: g.p?.reference ?? '',
      'Code-barres': g.p?.barcode ?? '',
      Produit: g.p?.name ?? '',
      Catégorie: g.p?.category ?? '',
      Temporaire: g.p?.isTemp ? 'oui' : '',
      Unité: c.unitLabel(g.unit),
      Quantité: g.qty,
      'Équiv. pièces': g.unit === 'carton' && g.p?.cartonQty ? g.qty * g.p.cartonQty : '',
      Comptages: g.n,
      'Dernier comptage': fmtDateTime(g.last, c.lang),
    }));
}

/** Grand totals per product and unit across all locations. */
export async function totalsRows(c: Ctx): Promise<Row[]> {
  const { records, products } = await load(c.sessionId);
  const byProduct = new Map<string, typeof records>();
  for (const r of records) if (!r.voidedAt) byProduct.set(r.productId, [...(byProduct.get(r.productId) ?? []), r]);
  const out: Row[] = [];
  for (const [pid, recs] of byProduct) {
    const p = products.get(pid);
    const totals = sumByUnit(recs);
    for (const [unit, qty] of Object.entries(totals)) {
      out.push({
        Référence: p?.reference ?? '',
        'Code-barres': p?.barcode ?? '',
        Produit: p?.name ?? '',
        Unité: c.unitLabel(unit),
        'Quantité totale': qty,
        'Équiv. pièces': unit === 'carton' && p?.cartonQty ? qty * p.cartonQty : '',
        Emplacements: new Set(recs.map((r) => r.locationId)).size,
      });
    }
  }
  return out.sort((a, b) => String(a.Produit).localeCompare(String(b.Produit)));
}

export async function unknownRows(c: Ctx): Promise<Row[]> {
  const { records, locMap } = await load(c.sessionId);
  const temps = (await db.products.filter((p) => p.isTemp && !p.mergedInto).toArray()).sort((a, b) =>
    (a.reference ?? '').localeCompare(b.reference ?? '')
  );
  return temps.map((p) => {
    const recs = records.filter((r) => r.productId === p.id);
    return {
      'Réf. temporaire': p.reference ?? '',
      Produit: p.name,
      Description: p.description ?? '',
      Catégorie: p.category ?? '',
      Photos: p.photoIds.length,
      'Quantité comptée': Object.entries(sumByUnit(recs))
        .map(([u, q]) => `${fmtNum(q)} ${c.unitLabel(u)}`)
        .join(' + '),
      Emplacements: [...new Set(recs.filter((r) => !r.voidedAt).map((r) => locName(locMap.get(r.locationId) ?? { zone: '?', shelf: '' })))].join(', '),
      Créé: fmtDateTime(p.createdAt, c.lang),
    };
  });
}

export async function locationRows(c: Ctx): Promise<Row[]> {
  const { locations, records } = await load(c.sessionId);
  return locations.map((l) => {
    const recs = records.filter((r) => r.locationId === l.id && !r.voidedAt);
    return {
      Zone: l.zone,
      Rayon: l.shelf,
      Terminé: l.completed ? 'oui' : 'non',
      'Produits distincts': new Set(recs.map((r) => r.productId)).size,
      Comptages: recs.length,
      Quantités: Object.entries(sumByUnit(recs))
        .map(([u, q]) => `${fmtNum(q)} ${c.unitLabel(u)}`)
        .join(' + '),
    };
  });
}

export async function historyRows(c: Ctx): Promise<Row[]> {
  const { records, products, locMap } = await load(c.sessionId);
  return [...records]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((r) => {
      const p = products.get(r.productId);
      const l = locMap.get(r.locationId);
      return {
        Date: fmtDateTime(r.createdAt, c.lang),
        Zone: l?.zone ?? '',
        Rayon: l?.shelf ?? '',
        Référence: p?.reference ?? '',
        Produit: p?.name ?? '',
        Unité: c.unitLabel(r.unit),
        Quantité: r.qty,
        Statut: r.voidedAt ? (r.supersededBy ? 'corrigé' : 'annulé') : r.supersedes ? 'correction' : 'valide',
      };
    });
}

export type ReportKind = 'full' | 'inventory' | 'unknown' | 'locations';

export async function exportReport(kind: ReportKind, format: 'xlsx' | 'csv', c: Ctx) {
  const base = `inventaire-${kind}-${stamp()}`;
  if (kind === 'full') {
    const sheets = [
      { name: 'Inventaire', rows: await inventoryRows(c) },
      { name: 'Totaux produits', rows: await totalsRows(c) },
      { name: 'Emplacements', rows: await locationRows(c) },
      { name: 'Inconnus', rows: await unknownRows(c) },
      { name: 'Historique', rows: await historyRows(c) },
    ];
    if (format === 'xlsx') return downloadXlsx(base, sheets);
    return downloadCsv(base, sheets[0].rows);
  }
  const rows = kind === 'inventory' ? await inventoryRows(c) : kind === 'unknown' ? await unknownRows(c) : await locationRows(c);
  if (format === 'xlsx') return downloadXlsx(base, [{ name: kind, rows }]);
  return downloadCsv(base, rows);
}

/** Excel file of the whole product master (used by the backup package and exports). */
export async function productRows(): Promise<Row[]> {
  const prods = (await db.products.filter((p) => !p.mergedInto).toArray()).sort((a, b) => a.name.localeCompare(b.name));
  return prods.map((p) => ({
    Référence: p.reference ?? '',
    'Code-barres': p.barcode ?? '',
    Produit: p.name,
    Description: p.description ?? '',
    Catégorie: p.category ?? '',
    Unité: p.unit,
    'Pièces par carton': p.cartonQty ?? '',
    Temporaire: p.isTemp ? 'oui' : '',
  }));
}

/** ZIP: photos/<ref>_<n>.jpg + produits.csv. Returns the number of photos packed. */
export async function exportPhotoPackage(onProgress?: (done: number, total: number) => void): Promise<number> {
  const prods = await db.products.filter((p) => !p.mergedInto && p.photoIds.length > 0).toArray();
  const total = prods.reduce((n, p) => n + p.photoIds.length, 0);
  const zip = new JSZip();
  let done = 0;
  const csvRows: Row[] = [];
  for (const p of prods) {
    const stem = sanitizeFile(p.reference || p.barcode || p.id);
    const files: string[] = [];
    let i = 0;
    for (const pid of p.photoIds) {
      const ph = await db.photos.get(pid);
      i++;
      if (ph) {
        const name = `photos/${stem}_${i}.jpg`;
        zip.file(name, ph.blob);
        files.push(name);
      }
      done++;
      onProgress?.(done, total);
    }
    csvRows.push({ Référence: p.reference ?? '', 'Code-barres': p.barcode ?? '', Produit: p.name, Fichiers: files.join(' | ') });
  }
  zip.file('produits.csv', '﻿' + rowsToCsv(csvRows));
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  saveBlob(blob, `photos-produits-${stamp()}.zip`);
  return total;
}

export { buildXlsx };
