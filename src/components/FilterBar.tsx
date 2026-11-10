import { useMemo, useState } from 'react';
import { useApp } from '../context';
import type { Loc } from '../types';
import type { Filters } from '../lib/filters';
import { EMPTY_FILTERS } from '../lib/filters';
import { locName } from '../lib/locations';
import { Icon, Input, Select } from './ui';

export default function FilterBar({ locations, value, onChange }: { locations: Loc[]; value: Filters; onChange: (f: Filters) => void }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const zones = useMemo(() => [...new Set(locations.map((l) => l.zone))], [locations]);
  const shelves = useMemo(() => locations.filter((l) => !value.zone || l.zone === value.zone), [locations, value.zone]);
  const active = JSON.stringify(value) !== JSON.stringify(EMPTY_FILTERS);
  return (
    <div className="card !p-3">
      <button className="flex w-full items-center justify-between" onClick={() => setOpen((o) => !o)}>
        <span className="flex items-center gap-2 font-semibold">
          <Icon name="search" className="h-5 w-5" /> {t('filters')}
          {active && <span className="rounded-full bg-accent px-2 text-xs">●</span>}
        </span>
        <span className="text-sm text-white/50">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Select value={value.zone} onChange={(e) => onChange({ ...value, zone: e.target.value, locId: '' })}>
            <option value="">{t('filter.allZones')}</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Select>
          <Select value={value.locId} onChange={(e) => onChange({ ...value, locId: e.target.value })}>
            <option value="">{t('filter.allShelves')}</option>
            {shelves.map((l) => (
              <option key={l.id} value={l.id}>
                {locName(l)}
              </option>
            ))}
          </Select>
          <Input value={value.q} onChange={(e) => onChange({ ...value, q: e.target.value })} placeholder={t('filter.product')} />
          <Input type="date" value={value.date} onChange={(e) => onChange({ ...value, date: e.target.value })} />
          <label className="col-span-2 flex min-h-12 items-center gap-3 rounded-2xl border border-line bg-panel2 px-4">
            <input type="checkbox" className="h-5 w-5 accent-[#2f7bff]" checked={value.unknown} onChange={(e) => onChange({ ...value, unknown: e.target.checked })} />
            {t('filter.unknownOnly')}
          </label>
          {active && (
            <button className="btn btn-ghost col-span-2 !min-h-12" onClick={() => onChange(EMPTY_FILTERS)}>
              {t('filter.reset')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
