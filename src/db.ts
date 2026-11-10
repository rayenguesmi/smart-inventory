import Dexie, { type Table } from 'dexie';
import type { CountRecord, Loc, MetaRow, PhotoRow, Product, Session } from './types';

class AppDB extends Dexie {
  products!: Table<Product, string>;
  sessions!: Table<Session, string>;
  locations!: Table<Loc, string>;
  records!: Table<CountRecord, string>;
  photos!: Table<PhotoRow, string>;
  meta!: Table<MetaRow, string>;

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
