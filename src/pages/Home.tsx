import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta } from '../db';
import { useApp } from '../context';
import { Shell, Page } from '../components/Shell';
import { Badge, Btn, Card, Icon, Stat } from '../components/ui';
import FilterBar from '../components/FilterBar';
import { EMPTY_FILTERS, filterRecords, type Filters } from '../lib/filters';
import { useSessionData } from '../lib/hooks';
import { fmtTotals, sumByUnit } from '../lib/records';
import { locName } from '../lib/locations';
import { fmtDateTime, fmtNum } from '../lib/util';
import { go } from '../router';

export default function Home() {
  const { t, unitLabel, settings, session, sessionId } = useApp();
  const data = useSessionData(sessionId);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const global = useLiveQuery(async () => {
    const prods = await db.products.filter((p) => !p.mergedInto).toArray();
    return { unique: prods.length, unknown: prods.filter((p) => p.isTemp).length, missing: prods.filter((p) => !p.reference).length };
  }, []);
  const lastBackup = useLiveQuery(() => getMeta<number | null>('lastBackup', null), []);

  const active = useMemo(() => (data ? filterRecords(data, filters).filter((r) => !r.voidedAt) : []), [data, filters]);
  const totals = sumByUnit(active);
  const countedProducts = new Set(active.map((r) => r.productId)).size;
  const unknownCounted = new Set(active.filter((r) => data?.products.get(r.productId)?.isTemp).map((r) => r.productId)).size;
  const done = data?.locations.filter((l) => l.completed).length ?? 0;
  const totalLocs = data?.locations.length ?? 0;
  const recent = useMemo(() => [...active].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8), [active]);
  const locMap = new Map((data?.locations ?? []).map((l) => [l.id, l]));
  const staleBackup = !!data?.records.length && (!lastBackup || Date.now() - lastBackup > 24 * 3600 * 1000);

  return (
    <Shell title="SMART INVENTORY">
      <Page>
        {session ? (
          <Card className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-xl font-bold">{session.name}</p>
                <p className="truncate text-sm text-white/50">
                  {session.warehouse} · {session.date}
                </p>
              </div>
              <Badge tone={session.status === 'active' ? 'ok' : 'warn'}>{t('session.status.' + session.status)}</Badge>
            </div>
            <Btn variant="primary" className="w-full !min-h-16 text-lg" onClick={() => go('/scan')}>
              <Icon name="scan" className="h-7 w-7" /> {t('home.continue')}
            </Btn>
            <div className="grid grid-cols-2 gap-2">
              <Btn onClick={() => go('/sessions')}>{t('home.switchSession')}</Btn>
              <Btn onClick={() => go('/locations')}>
                <Icon name="pin" className="h-5 w-5" /> {t('nav.locations')}
              </Btn>
            </div>
          </Card>
        ) : (
          <Card className="space-y-3 text-center">
            <Icon name="layers" className="mx-auto h-10 w-10 text-accent2" />
            <p className="text-lg font-semibold">{t('home.noSession')}</p>
            <p className="text-sm text-white/50">{t('home.noSessionHelp')}</p>
            <Btn variant="primary" className="w-full" onClick={() => go('/session/new')}>
              <Icon name="plus" /> {t('session.new')}
            </Btn>
            <Btn className="w-full" onClick={() => go('/sessions')}>
              {t('sessions')}
            </Btn>
          </Card>
        )}

        {staleBackup && (
          <button onClick={() => go('/backup')} className="flex w-full items-center gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-start text-sm text-amber-200">
            <Icon name="shield" className="h-6 w-6 shrink-0" />
            <span>{t('home.backupWarn')}</span>
          </button>
        )}

        {session && data && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Stat label={t('stat.productsCounted')} value={countedProducts} />
              <Stat label={t('stat.records')} value={active.length} />
              <Stat label={t('stat.unknownCounted')} value={unknownCounted} tone={unknownCounted ? 'warn' : undefined} />
              <Stat label={t('stat.locations')} value={`${done}/${totalLocs}`} sub={`${t('stat.remaining')}: ${totalLocs - done}`} tone={totalLocs && done === totalLocs ? 'ok' : undefined} />
            </div>
            <Card>
              <p className="text-xs text-white/50">{t('stat.units')}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {Object.keys(totals).length ? (
                  Object.entries(totals).map(([u, q]) => (
                    <span key={u} className="chip !text-base font-semibold">
                      {fmtNum(q)} <span className="font-normal text-white/60">{unitLabel(u)}</span>
                    </span>
                  ))
                ) : (
                  <span className="text-white/40">0</span>
                )}
              </div>
            </Card>
            <FilterBar locations={data.locations} value={filters} onChange={setFilters} />
          </>
        )}

        <div className="grid grid-cols-3 gap-3">
          <Stat label={t('stat.uniqueProducts')} value={global?.unique ?? '…'} />
          <Stat label={t('stat.unknownProducts')} value={global?.unknown ?? '…'} tone={global?.unknown ? 'warn' : undefined} />
          <Stat label={t('stat.missingRef')} value={global?.missing ?? '…'} tone={global?.missing ? 'warn' : undefined} />
        </div>

        {session && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-semibold">{t('stat.recent')}</h2>
              <button className="text-sm text-accent2" onClick={() => go('/history')}>
                {t('nav.history')} →
              </button>
            </div>
            {recent.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-white/40">{t('stat.noActivity')}</p>
            ) : (
              <div className="space-y-2">
                {recent.map((r) => {
                  const p = data?.products.get(r.productId);
                  const l = locMap.get(r.locationId);
                  return (
                    <button key={r.id} onClick={() => p && go('/p/' + p.id)} className="card flex w-full items-center justify-between gap-3 !p-3 text-start">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{p?.name ?? '—'}</p>
                        <p className="truncate text-xs text-white/40">
                          {l ? locName(l) : '—'} · {fmtDateTime(r.createdAt, settings.lang)}
                        </p>
                      </div>
                      <span className="shrink-0 text-lg font-bold">
                        {fmtNum(r.qty)} <span className="text-sm font-normal text-white/50">{unitLabel(r.unit)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {active.length > 0 && <p className="mt-2 text-center text-xs text-white/30">{fmtTotals(totals, unitLabel)}</p>}
          </div>
        )}
      </Page>
    </Shell>
  );
}
