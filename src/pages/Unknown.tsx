import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useApp } from '../context';
import { Shell, Page } from '../components/Shell';
import { Badge, Btn, Card, Empty, Icon, Thumb } from '../components/ui';
import { fmtTotals, sumByUnit } from '../lib/records';
import { fmtDateTime } from '../lib/util';
import { go } from '../router';

/** Screen 10: temporary (TMP-xxxx) products waiting for a permanent identity. */
export default function Unknown() {
  const { t, unitLabel, settings } = useApp();
  const rows = useLiveQuery(async () => {
    const temps = (await db.products.filter((p) => p.isTemp && !p.mergedInto).toArray()).sort((a, b) => (a.reference ?? '').localeCompare(b.reference ?? ''));
    const out = [];
    for (const p of temps) {
      const recs = await db.records.where('productId').equals(p.id).toArray();
      out.push({ p, totals: sumByUnit(recs) });
    }
    return out;
  }, []);

  return (
    <Shell title={t('nav.unknown')} back="/more" right={<Btn variant="primary" className="!min-h-12 !px-3" onClick={() => go('/reports')}><Icon name="download" /></Btn>}>
      <Page>
        <Card className="text-sm text-white/60">{t('unknown.help')}</Card>
        {!rows ? null : rows.length === 0 ? (
          <Empty icon="help" title={t('unknown.none')} text={t('unknown.noneHelp')} />
        ) : (
          rows.map(({ p, totals }) => (
            <Card key={p.id} className="space-y-3">
              <div className="flex gap-3">
                <Thumb photoId={p.photoIds[0]} className="h-20 w-20" />
                <div className="min-w-0 flex-1">
                  <Badge tone="warn">{p.reference}</Badge>
                  <p className="mt-1 truncate text-lg font-bold">{p.name}</p>
                  {p.description && <p className="line-clamp-2 text-sm text-white/50">{p.description}</p>}
                  <p className="text-xs text-white/40">
                    {fmtDateTime(p.createdAt, settings.lang)} · {p.photoIds.length} {t('form.photos').toLowerCase()}
                  </p>
                </div>
              </div>
              <p className="text-sm">
                {t('product.totalAll')}: <b>{fmtTotals(totals, unitLabel)}</b>
              </p>
              <div className="grid grid-cols-2 gap-2">
                <Btn variant="primary" onClick={() => go('/product/edit/' + p.id)}>
                  <Icon name="tag" className="h-5 w-5" /> {t('unknown.identify')}
                </Btn>
                <Btn onClick={() => go('/p/' + p.id)}>
                  <Icon name="merge" className="h-5 w-5" /> {t('unknown.details')}
                </Btn>
              </div>
            </Card>
          ))
        )}
      </Page>
    </Shell>
  );
}
