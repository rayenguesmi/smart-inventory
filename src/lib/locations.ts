import { db } from '../db';
import type { Loc } from '../types';
import { naturalCompare, norm, uid } from './util';
import { AppError } from './products';

export const locName = (l: Pick<Loc, 'zone' | 'shelf'>): string => (l.shelf ? `${l.zone} / ${l.shelf}` : l.zone);

export const sortLocs = (a: Loc, b: Loc) => naturalCompare(a.zone, b.zone) || naturalCompare(a.shelf, b.shelf);

export async function addLocation(sessionId: string, zone: string, shelf = ''): Promise<Loc> {
  zone = norm(zone);
  shelf = norm(shelf);
  if (!zone) throw new AppError('BAD_REF');
  const existing = await db.locations.where('sessionId').equals(sessionId).toArray();
  const hit = existing.find((l) => l.zone.toLowerCase() === zone.toLowerCase() && l.shelf.toLowerCase() === shelf.toLowerCase());
  if (hit) return hit;
  const loc: Loc = { id: uid(), sessionId, zone, shelf, completed: false, createdAt: Date.now() };
  await db.locations.add(loc);
  return loc;
}

/** Rayon 01 … Rayon NN */
export async function addShelvesBulk(sessionId: string, zone: string, prefix: string, count: number): Promise<number> {
  let added = 0;
  const width = Math.max(2, String(count).length);
  for (let i = 1; i <= count; i++) {
    const shelf = `${norm(prefix) || 'Rayon'} ${String(i).padStart(width, '0')}`;
    const before = await db.locations.where('sessionId').equals(sessionId).count();
    await addLocation(sessionId, zone, shelf);
    const after = await db.locations.where('sessionId').equals(sessionId).count();
    if (after > before) added++;
  }
  return added;
}

export async function renameZone(sessionId: string, oldZone: string, newZone: string): Promise<void> {
  newZone = norm(newZone);
  if (!newZone) throw new AppError('BAD_REF');
  await db.transaction('rw', db.locations, async () => {
    const all = await db.locations.where('sessionId').equals(sessionId).toArray();
    for (const l of all) if (l.zone === oldZone) await db.locations.put({ ...l, zone: newZone });
  });
}

export async function renameShelf(id: string, newShelf: string): Promise<void> {
  const l = await db.locations.get(id);
  if (!l) throw new AppError('NOT_FOUND');
  await db.locations.put({ ...l, shelf: norm(newShelf) });
}

export async function setCompleted(id: string, completed: boolean): Promise<void> {
  await db.locations.update(id, { completed });
}

/** Locations holding counting records are never deleted. Returns false when blocked. */
export async function deleteLocationIfEmpty(id: string): Promise<boolean> {
  const n = await db.records.where('locationId').equals(id).count();
  if (n > 0) return false;
  await db.locations.delete(id);
  return true;
}
