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
import { exportProductMasterCsv, exportDetailedStockCsv } from '../lib/csvManager';

export default function Home() {
  const { t, unitLabel, settings, session, sessionId } = useApp();
  const data = useSessionData(sessionId);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const global = useLiveQuery(async () => {
    const prods = await db.products.filter((p) => !p.mergedInto).toArray();
    return { unique: prods.length, unknown: prods.filter((p) => p.isTemp).length, missing: prods.filter((p) => !p.reference).length };
  }, []);
  const lastBackup = useLiveQuery(() => getMeta<number | null>('lastBackup', null), []);

  // Stock OUT quick stats and recent docs
  const stockOutData = useLiveQuery(async () => {
    const docs = await db.stockOuts.toArray();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTodayMs = startOfToday.getTime();

    let todayQty = 0;
    let confirmedCount = 0;
    let draftCount = 0;

    for (const d of docs) {
      if (d.status === 'confirmed') {
        confirmedCount++;
        const dateMs = d.confirmedAt ?? d.dateTime;
        if (dateMs >= startOfTodayMs) todayQty += d.totalQuantity;
      } else if (d.status === 'draft') {
        draftCount++;
      }
    }

    const recentDocs = [...docs].sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
    return { total: docs.length, confirmedCount, draftCount, todayQty, recentDocs };
  }, []);

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
            <div className="grid grid-cols-2 gap-2 pt-1 border-t border-line">
              <Btn onClick={() => exportProductMasterCsv()} className="!min-h-9 !px-2 text-xs">
                <Icon name="download" className="h-3.5 w-3.5" />
                {settings.lang === 'ar' ? 'تصدير الكتالوج CSV' : 'Export Catalogue CSV'}
              </Btn>
              <Btn onClick={() => exportDetailedStockCsv()} className="!min-h-9 !px-2 text-xs">
                <Icon name="download" className="h-3.5 w-3.5" />
                {settings.lang === 'ar' ? 'تصدير المخزون CSV' : 'Export Stock CSV'}
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

        {/* STOCK OUT CARD */}
        <Card className="space-y-3 border-accent2/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/20 text-accent">
                <Icon name="truck" className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm">
                  {settings.lang === 'ar' ? 'حركات الصرف المخزني (Stock OUT)' : 'Sorties de Stock (Stock OUT)'}
                </h3>
                <p className="text-[11px] text-white/50">
                  {settings.lang === 'ar'
                    ? `اليوم: ${fmtNum(stockOutData?.todayQty ?? 0)} وحدة · ${stockOutData?.confirmedCount ?? 0} مؤكد`
                    : `Aujourd'hui: ${fmtNum(stockOutData?.todayQty ?? 0)} unités · ${stockOutData?.confirmedCount ?? 0} confirmés`}
                </p>
              </div>
            </div>
            {stockOutData && stockOutData.draftCount > 0 && (
              <Badge tone="warn">
                {stockOutData.draftCount} {settings.lang === 'ar' ? 'مسودة' : 'brouillons'}
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Btn variant="primary" onClick={() => go('/stock-out/new')} className="!min-h-10 text-xs">
              <Icon name="plus" className="h-4 w-4" />
              {t('stockOut.newStockOut')}
            </Btn>
            <Btn onClick={() => go('/stock-out')} className="!min-h-10 text-xs">
              <Icon name="truck" className="h-4 w-4" />
              {settings.lang === 'ar' ? 'لوحة الصرف' : 'Tableau de bord'}
            </Btn>
          </div>

          {stockOutData && stockOutData.recentDocs.length > 0 && (
            <div className="space-y-1.5 border-t border-line pt-2">
              {stockOutData.recentDocs.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => go(`/stock-out/${doc.id}`)}
                  className="flex w-full items-center justify-between rounded-lg bg-panel2/40 px-2.5 py-1.5 text-xs text-start hover:bg-panel2 transition"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono font-bold text-accent2">{doc.docNo}</span>
                    <span className="truncate text-white/70">{doc.recipient}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="font-mono font-semibold">{fmtNum(doc.totalQuantity)}</span>
                    <span
                      className={`h-2 w-2 rounded-full ${
                        doc.status === 'confirmed'
                          ? 'bg-emerald-400'
                          : doc.status === 'draft'
                          ? 'bg-amber-400'
                          : 'bg-red-400'
                      }`}
                    />
                  </div>
                </button>
              ))}
            </div>
          )}
        </Card>

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
