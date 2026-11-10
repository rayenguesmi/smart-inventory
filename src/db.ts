import Dexie, { type Table } from 'dexie';
import type { CountRecord, Loc, MetaRow, PhotoRow, Product, Session, StockOutDocument } from './types';

class AppDB extends Dexie {
  products!: Table<Product, string>;
  sessions!: Table<Session, string>;
  locations!: Table<Loc, string>;
  records!: Table<CountRecord, string>;
  photos!: Table<PhotoRow, string>;
  meta!: Table<MetaRow, string>;
  stockOuts!: Table<StockOutDocument, string>;

  constructor() {
    super('smart-inventory');
    this.version(1).stores({
      // &refKey / &barcode are UNIQUE indexes: the database itself refuses duplicates.
      // Products without a barcode/reference simply have no entry in those indexes.
      products: 'id, &refKey, &barcode, *aliases, name, isTemp, mergedInto, updatedAt',
      sessions: 'id, status, createdAt',
      locations: 'id, sessionId, zone',
      records: 'id, sessionId, locationId, productId, createdAt',
      photos: 'id',
      meta: 'key',
    });
    this.version(2).stores({
      products: 'id, &refKey, &barcode, &internalBarcode, originalBarcode, *aliases, name, isTemp, mergedInto, updatedAt',
    });
    this.version(3).stores({
      stockOuts: 'id, &docNo, status, warehouse, recipient, reason, date, createdAt',
      records: 'id, sessionId, locationId, productId, docId, type, createdAt',
    });
  }
}

export const db = new AppDB();

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await db.meta.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setMeta(key: string, value: any): Promise<void> {
  await db.meta.put({ key, value });
}
