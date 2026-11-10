import type { CountRecord, Loc, Product } from '../types';
import { dayOf } from './util';

export interface Filters {
  zone: string;
  locId: string;
  q: string;
  date: string;
  unknown: boolean;
}

export const EMPTY_FILTERS: Filters = { zone: '', locId: '', q: '', date: '', unknown: false };

export interface SessionData {
  records: CountRecord[];
  locations: Loc[];
  products: Map<string, Product>;
}

export function filterRecords(data: SessionData, f: Filters): CountRecord[] {
  const locs = new Map(data.locations.map((l) => [l.id, l]));
  const q = f.q.trim().toLowerCase();
  return data.records.filter((r) => {
    const loc = locs.get(r.locationId);
    if (f.zone && loc?.zone !== f.zone) return false;
    if (f.locId && r.locationId !== f.locId) return false;
    if (f.date && dayOf(r.createdAt) !== f.date) return false;
    const p = data.products.get(r.productId);
    if (f.unknown && !p?.isTemp) return false;
    if (q) {
      const hay = `${p?.name ?? ''} ${p?.reference ?? ''} ${p?.barcode ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
