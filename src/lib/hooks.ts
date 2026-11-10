import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Product } from '../types';
import type { SessionData } from './filters';
import { sortLocs } from './locations';

/** Records + locations + the products they reference, live-updated. */
export function useSessionData(sessionId?: string | null): SessionData | undefined {
  return useLiveQuery(async () => {
    if (!sessionId) return undefined;
    const [records, locations] = await Promise.all([
      db.records.where('sessionId').equals(sessionId).toArray(),
      db.locations.where('sessionId').equals(sessionId).toArray(),
    ]);
    const ids = [...new Set(records.map((r) => r.productId))];
    const products = new Map<string, Product>();
    (await db.products.bulkGet(ids)).forEach((p) => p && products.set(p.id, p));
    return { records, locations: locations.sort(sortLocs), products };
  }, [sessionId]);
}

export function useLocations(sessionId?: string | null) {
  return useLiveQuery(async () => {
    if (!sessionId) return [];
    return (await db.locations.where('sessionId').equals(sessionId).toArray()).sort(sortLocs);
  }, [sessionId]);
}
