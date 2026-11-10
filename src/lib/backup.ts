import { db, setMeta } from '../db';
import type { CountRecord, Loc, Product, Session } from '../types';
import { blobToDataUrl, dataUrlToBlob, saveBlob, stamp } from './util';

export const BACKUP_APP = 'smart-inventory';
export const BACKUP_VERSION = 1;

interface BackupPhoto {
  id: string;
  createdAt: number;
  demo?: boolean;
  dataUrl?: string;
}

export interface BackupFile {
  app: string;
  version: number;
  exportedAt: number;
  includesPhotos: boolean;
  tables: {
    products: Product[];
    sessions: Session[];
    locations: Loc[];
    records: CountRecord[];
    photos: BackupPhoto[];
    meta: { key: string; value: unknown }[];
  };
}

export async function buildBackup(includePhotos: boolean): Promise<BackupFile> {
  const [products, sessions, locations, records, photoRows, meta] = await Promise.all([
    db.products.toArray(),
    db.sessions.toArray(),
    db.locations.toArray(),
    db.records.toArray(),
    db.photos.toArray(),
    db.meta.toArray(),
  ]);
  const photos: BackupPhoto[] = [];
  for (const p of photoRows) {
    photos.push({
      id: p.id,
      createdAt: p.createdAt,
      demo: p.demo,
      dataUrl: includePhotos ? await blobToDataUrl(p.blob) : undefined,
    });
  }
  return {
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    includesPhotos: includePhotos,
    tables: { products, sessions, locations, records, photos, meta },
  };
}

export async function downloadBackup(includePhotos: boolean): Promise<number> {
  const b = await buildBackup(includePhotos);
  const blob = new Blob([JSON.stringify(b)], { type: 'application/json' });
  saveBlob(blob, `smart-inventory-backup-${stamp()}${includePhotos ? '' : '-sans-photos'}.json`);
  await setMeta('lastBackup', Date.now());
  return blob.size;
}

export interface Validation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  summary?: { products: number; sessions: number; locations: number; records: number; photos: number; exportedAt: number; includesPhotos: boolean };
  data?: BackupFile;
}

const isArr = Array.isArray;

/** Structural + referential validation. Nothing is written to the database here. */
export function validateBackup(text: string): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['JSON_INVALID'], warnings };
  }
  if (!obj || obj.app !== BACKUP_APP) return { ok: false, errors: ['NOT_BACKUP'], warnings };
  if (typeof obj.version !== 'number' || obj.version > BACKUP_VERSION) errors.push('VERSION');
  const t = obj.tables;
  if (!t) return { ok: false, errors: [...errors, 'NO_TABLES'], warnings };
  for (const k of ['products', 'sessions', 'locations', 'records', 'photos', 'meta']) {
    if (!isArr(t[k])) errors.push('TABLE:' + k);
  }
  if (errors.length) return { ok: false, errors, warnings };

  const ids = (arr: any[], name: string) => {
    const s = new Set<string>();
    for (const x of arr) {
      if (!x || typeof x.id !== 'string' || !x.id) {
        errors.push(`ID:${name}`);
        break;
      }
      if (s.has(x.id)) {
        errors.push(`DUP_ID:${name}`);
        break;
      }
      s.add(x.id);
    }
    return s;
  };
  const prodIds = ids(t.products, 'products');
  const sessIds = ids(t.sessions, 'sessions');
  const locIds = ids(t.locations, 'locations');
  ids(t.records, 'records');
  const photoIds = ids(t.photos, 'photos');

  const refKeys = new Set<string>();
  const barcodes = new Set<string>();
  for (const p of t.products) {
    if (typeof p.name !== 'string' || !Array.isArray(p.photoIds)) {
      errors.push('PRODUCT_SHAPE');
      break;
    }
    if (p.refKey) {
      if (refKeys.has(p.refKey)) {
        errors.push('DUP_REF');
        break;
      }
      refKeys.add(p.refKey);
    }
    if (p.barcode) {
      if (barcodes.has(p.barcode)) {
        errors.push('DUP_BARCODE');
        break;
      }
      barcodes.add(p.barcode);
    }
  }
  for (const r of t.records) {
    if (typeof r.qty !== 'number' || !Number.isFinite(r.qty) || r.qty < 0) {
      errors.push('RECORD_QTY');
      break;
    }
    if (!prodIds.has(r.productId) || !locIds.has(r.locationId) || !sessIds.has(r.sessionId)) {
      errors.push('RECORD_REF');
      break;
    }
  }
  for (const l of t.locations) {
    if (!sessIds.has(l.sessionId)) {
      errors.push('LOC_REF');
      break;
    }
  }
  let missingPhotos = 0;
  for (const p of t.products) for (const id of p.photoIds) if (!photoIds.has(id)) missingPhotos++;
  if (missingPhotos) warnings.push('MISSING_PHOTOS:' + missingPhotos);
  if (!obj.includesPhotos) warnings.push('NO_PHOTOS');

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    data: errors.length ? undefined : (obj as BackupFile),
    summary: {
      products: t.products.length,
      sessions: t.sessions.length,
      locations: t.locations.length,
      records: t.records.length,
      photos: t.photos.length,
      exportedAt: obj.exportedAt,
      includesPhotos: !!obj.includesPhotos,
    },
  };
}

/** Replaces ALL local data with the backup. The caller must have asked for confirmation. */
export async function restoreBackup(b: BackupFile): Promise<void> {
  // Blob conversion is async-non-Dexie work, so it must happen before the transaction starts.
  const photoRows = [];
  for (const p of b.tables.photos) {
    if (p.dataUrl) photoRows.push({ id: p.id, createdAt: p.createdAt, demo: p.demo, blob: await dataUrlToBlob(p.dataUrl) });
  }
  const keepPhotos = !b.includesPhotos ? await db.photos.toArray() : [];
  await db.transaction('rw', [db.products, db.sessions, db.locations, db.records, db.photos, db.meta], async () => {
    await Promise.all([db.products.clear(), db.sessions.clear(), db.locations.clear(), db.records.clear(), db.photos.clear(), db.meta.clear()]);
    await db.products.bulkAdd(b.tables.products);
    await db.sessions.bulkAdd(b.tables.sessions);
    await db.locations.bulkAdd(b.tables.locations);
    await db.records.bulkAdd(b.tables.records);
    await db.photos.bulkAdd(photoRows.length ? photoRows : keepPhotos);
    await db.meta.bulkAdd(b.tables.meta as any);
  });
}

export async function wipeAll(): Promise<void> {
  await db.transaction('rw', [db.products, db.sessions, db.locations, db.records, db.photos, db.meta], async () => {
    await Promise.all([db.products.clear(), db.sessions.clear(), db.locations.clear(), db.records.clear(), db.photos.clear(), db.meta.clear()]);
  });
}
