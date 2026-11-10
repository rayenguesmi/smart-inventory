import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useApp } from '../context';
import { Shell, Page } from '../components/Shell';
import { Badge, Btn, Card, Empty, Icon, Input, Sheet, Thumb } from '../components/ui';
import { usePhotoUrl } from '../lib/image';
import { AppError, mergeProducts } from '../lib/products';
import { fmtTotals, sumByUnit } from '../lib/records';
import { locName } from '../lib/locations';
import { fmtDateTime, fmtNum } from '../lib/util';
import { go } from '../router';

function BigPhoto({ id }: { id: string }) {
  const url = usePhotoUrl(id);
  return url ? <img src={url} alt="" className="max-h-[70dvh] w-full rounded-2xl object-contain" /> : null;
}

/** Product card: gallery, totals per location, full counting history, merge. */
export default function ProductDetail({ id }: { id: string }) {
  const { t, unitLabel, settings, sessionId, locationId, toast, confirm } = useApp();
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mq, setMq] = useState('');

  const data = useLiveQuery(async () => {
    const product = await db.products.get(id);
    if (!product) return null;
    const records = await db.records.where('productId').equals(id).toArray();
    const sessIds = [...new Set(records.map((r) => r.sessionId))];
    const locIds = [...new Set(records.map((r) => r.locationId))];
    const sessions = new Map((await db.sessions.bulkGet(sessIds)).filter(Boolean).map((s) => [s!.id, s!]));
    const locs = new Map((await db.locations.bulkGet(locIds)).filter(Boolean).map((l) => [l!.id, l!]));
    return { product, records, sessions, locs };
  }, [id]);

  const candidates = useLiveQuery(async () => {
    if (!mergeOpen) return [];
    const s = mq.trim().toLowerCase();
    return (await db.products.filter((p) => !p.mergedInto && p.id !== id).toArray())
      .filter((p) => !s || p.name.toLowerCase().includes(s) || (p.reference ?? '').toLowerCase().includes(s) || (p.barcode ?? '').includes(s))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 40);
  }, [mergeOpen, mq, id]);

  const perLoc = useMemo(() => {
    if (!data) return [];
    const m = new Map<string, typeof data.records>();
    data.records.filter((r) => !r.voidedAt).forEach((r) => {
      const k = r.sessionId + '|' + r.locationId;
      m.set(k, [...(m.get(k) ?? []), r]);
    });
    return [...m.entries()].map(([k, recs]) => ({ k, recs, session: data.sessions.get(recs[0].sessionId), loc: data.locs.get(recs[0].locationId) }));
  }, [data]);

  if (data === undefined) return <Shell title="…" back noNav><Page><p className="text-white/50">{t('loading')}</p></Page></Shell>;
  if (data === null) return <Shell title={t('nav.products')} back noNav><Empty icon="alert" title={t('err.NOT_FOUND')} /></Shell>;
  const { product: p, records } = data;

  const doMerge = async (keepId: string, keepName: string) => {
    if (!(await confirm({ title: t('merge.title'), message: t('merge.confirm', { a: p.name, b: keepName }), confirmLabel: t('merge.do'), danger: true }))) return;
    try {
      await mergeProducts(keepId, p.id);
      toast(t('merge.done'));
      setMergeOpen(false);
      go('/p/' + keepId, true);
    } catch (e) {
      toast(e instanceof AppError ? t('err.' + e.code) : t('err.generic'), 'err');
    }
  };

  const all = sumByUnit(records);

  return (
    <Shell title={p.name} back right={!p.mergedInto && <Btn className="!min-h-11 !px-3" onClick={() => go('/product/edit/' + p.id)}><Icon name="edit" className="h-5 w-5" /></Btn>}>
      <Page>
        {p.mergedInto && (
          <Card className="space-y-2 border-amber-500/40 text-amber-200">
            <p>{t('merge.isMerged')}</p>
            <Btn onClick={() => go('/p/' + p.mergedInto)}>{t('merge.openTarget')}</Btn>
          </Card>
        )}

        <Card className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {p.isTemp && <Badge tone="warn">{t('unknown.temp')}</Badge>}
            {!p.reference && <Badge tone="warn">{t('stat.missingRef')}</Badge>}
            {p.category && <Badge tone="mute">{p.category}</Badge>}
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-white/40">{t('ref')}</dt>
            <dd className="font-mono">{p.reference ?? '—'}</dd>
            <dt className="text-white/40">{t('barcode')}</dt>
            <dd className="break-all font-mono">{p.barcode ?? '—'}</dd>
            <dt className="text-white/40">{t('unit')}</dt>
            <dd>
              {unitLabel(p.unit)}
              {p.cartonQty ? ` · 1 ${unitLabel('carton')} = ${p.cartonQty} ${unitLabel('piece')}` : ''}
            </dd>
            {p.aliases.length > 0 && (
              <>
                <dt className="text-white/40">{t('product.aliases')}</dt>
                <dd className="break-all font-mono text-xs">{p.aliases.join(', ')}</dd>
              </>
            )}
            <dt className="text-white/40">{t('product.created')}</dt>
            <dd>{fmtDateTime(p.createdAt, settings.lang)}</dd>
            <dt className="text-white/40">{t('product.updated')}</dt>
            <dd>{fmtDateTime(p.updatedAt, settings.lang)}</dd>
          </dl>
          {p.description && <p className="whitespace-pre-line border-t border-line pt-2 text-sm text-white/70">{p.description}</p>}
        </Card>

        {p.photoIds.length > 0 && (
          <div className="flex gap-2 overflow-x-auto">
            {p.photoIds.map((pid) => (
              <Thumb key={pid} photoId={pid} className="h-28 w-28" onClick={() => setViewPhoto(pid)} />
            ))}
          </div>
        )}

        {!p.mergedInto && (
          <div className="grid grid-cols-2 gap-3">
            <Btn variant="primary" disabled={!sessionId || !locationId} onClick={() => go('/quantity/' + p.id)}>
              <Icon name="plus" /> {t('qty.count')}
            </Btn>
            <Btn onClick={() => setMergeOpen(true)}>
              <Icon name="merge" /> {t('merge.title')}
            </Btn>
          </div>
        )}

        <Card>
          <p className="text-sm text-white/50">{t('product.totalAll')}</p>
          <p className="text-2xl font-bold">{fmtTotals(all, unitLabel)}</p>
        </Card>

        {perLoc.length > 0 && (
          <div>
            <h2 className="mb-2 font-semibold">{t('product.byLocation')}</h2>
            <div className="space-y-2">
              {perLoc.map(({ k, recs, session, loc }) => (
                <div key={k} className="card flex items-center justify-between gap-3 !p-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{loc ? locName(loc) : '—'}</p>
                    <p className="truncate text-xs text-white/40">{session?.name}</p>
                  </div>
                  <b className="shrink-0 text-end">{fmtTotals(sumByUnit(recs), unitLabel)}</b>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <h2 className="mb-2 font-semibold">{t('product.history')}</h2>
          {records.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm text-white/40">{t('history.empty')}</p>
          ) : (
            <div className="space-y-2">
              {[...records]
                .sort((a, b) => b.createdAt - a.createdAt)
                .map((r) => (
                  <div key={r.id} className={`card flex items-center justify-between gap-3 !p-3 ${r.voidedAt ? 'opacity-50' : ''}`}>
                    <div className="min-w-0">
                      <p className="truncate text-sm">{data.locs.get(r.locationId) ? locName(data.locs.get(r.locationId)!) : '—'}</p>
                      <p className="text-xs text-white/40">
                        {fmtDateTime(r.createdAt, settings.lang)}
                        {r.supersedes ? ` · ${t('history.correction')}` : ''}
                        {r.voidedAt ? ` · ${r.supersededBy ? t('history.corrected') : t('history.voided')}` : ''}
                        {r.fromProductId ? ` · ${t('history.merged')}` : ''}
                      </p>
                    </div>
                    <b className={`shrink-0 ${r.voidedAt ? 'line-through' : ''}`}>
                      {fmtNum(r.qty)} {unitLabel(r.unit)}
                    </b>
                  </div>
                ))}
            </div>
          )}
        </div>
      </Page>

      <Sheet open={!!viewPhoto} onClose={() => setViewPhoto(null)} title={p.name}>
        {viewPhoto && <BigPhoto id={viewPhoto} />}
      </Sheet>

      <Sheet open={mergeOpen} onClose={() => setMergeOpen(false)} title={t('merge.pick')}>
        <div className="space-y-3">
          <p className="text-sm text-white/60">{t('merge.help', { a: p.name })}</p>
          <Input value={mq} onChange={(e) => setMq(e.target.value)} placeholder={t('products.search')} />
          {(candidates ?? []).map((c) => (
            <button key={c.id} onClick={() => doMerge(c.id, c.name)} className="card flex w-full items-center gap-3 !p-2 text-start">
              <Thumb photoId={c.photoIds[0]} className="h-12 w-12" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.name}</span>
                <span className="block truncate text-xs text-white/40">{c.reference ?? '—'} {c.barcode ? `· ${c.barcode}` : ''}</span>
              </span>
            </button>
          ))}
        </div>
      </Sheet>
    </Shell>
  );
}
