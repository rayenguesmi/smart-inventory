import { useDeferredValue, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useApp } from '../context';
import { Shell, Page } from '../components/Shell';
import { Badge, Btn, Empty, Icon, Input, Thumb } from '../components/ui';
import { go } from '../router';
import type { Product } from '../types';

type Filter = 'all' | 'unknown' | 'noref';

export default function Products() {
  const { t, sessionId, locationId } = useApp();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(60);
  const dq = useDeferredValue(q);
  const all = useLiveQuery(async () => (await db.products.filter((p) => !p.mergedInto).toArray()).sort((a, b) => a.name.localeCompare(b.name)), []);

  const list = useMemo(() => {
    if (!all) return [];
    const s = dq.trim().toLowerCase();
    return all.filter((p) => {
      if (filter === 'unknown' && !p.isTemp) return false;
      if (filter === 'noref' && p.reference) return false;
      if (!s) return true;
      return (
        p.name.toLowerCase().includes(s) ||
        (p.reference ?? '').toLowerCase().includes(s) ||
        (p.barcode ?? '').includes(s) ||
        (p.category ?? '').toLowerCase().includes(s) ||
        (p.aliases ?? []).some((a) => a.toLowerCase().includes(s))
      );
    });
  }, [all, dq, filter]);

  const row = (p: Product) => (
    <div key={p.id} className="card flex items-center gap-3 !p-2">
      <button className="flex min-w-0 flex-1 items-center gap-3 text-start" onClick={() => go('/p/' + p.id)}>
        <Thumb photoId={p.photoIds[0]} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{p.name}</span>
          <span className="block truncate text-xs text-white/40">
            {p.reference ?? '—'}
            {p.barcode ? ` · ${p.barcode}` : ''}
          </span>
          {p.isTemp && <Badge tone="warn">{t('unknown.temp')}</Badge>}
        </span>
      </button>
      {sessionId && locationId && (
        <Btn variant="primary" className="!min-h-12 shrink-0 !px-3" onClick={() => go('/quantity/' + p.id)} aria-label={t('qty.count')}>
          <Icon name="plus" />
        </Btn>
      )}
    </div>
  );

  return (
    <Shell title={t('nav.products')} right={<Btn variant="primary" className="!min-h-12 !px-3" onClick={() => go('/product/new')}><Icon name="plus" /></Btn>}>
      <Page>
        <div className="relative">
          <Icon name="search" className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-white/30" />
          <Input value={q} onChange={(e) => { setQ(e.target.value); setLimit(60); }} placeholder={t('products.search')} className="!ps-12" />
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {(['all', 'unknown', 'noref'] as Filter[]).map((f) => (
            <button key={f} onClick={() => { setFilter(f); setLimit(60); }} className={`chip !px-4 !py-2.5 text-base ${filter === f ? '!border-accent !bg-accent/20' : 'text-white/60'}`}>
              {t('products.filter.' + f)}
            </button>
          ))}
        </div>
        {!all ? null : list.length === 0 ? (
          <Empty icon="box" title={t('products.empty')} text={all.length ? undefined : t('products.emptyHelp')} action={!all.length ? <Btn variant="primary" onClick={() => go('/import')}>{t('nav.import')}</Btn> : undefined} />
        ) : (
          <>
            <p className="text-xs text-white/40">{list.length} {t('products.count')}</p>
            <div className="space-y-2">{list.slice(0, limit).map(row)}</div>
            {list.length > limit && (
              <Btn className="w-full" onClick={() => setLimit((l) => l + 100)}>
                {t('showMore')} ({list.length - limit})
              </Btn>
            )}
          </>
        )}
      </Page>
    </Shell>
  );
}
