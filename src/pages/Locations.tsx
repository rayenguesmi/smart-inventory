import { useMemo, useState } from 'react';
import { useApp } from '../context';
import { Shell, Page } from '../components/Shell';
import { Badge, Btn, Card, Empty, Field, Icon, Input, Sheet } from '../components/ui';
import { useLocations } from '../lib/hooks';
import { addLocation, addShelvesBulk, deleteLocationIfEmpty, renameShelf, renameZone, setCompleted } from '../lib/locations';
import { go } from '../router';
import { db } from '../db';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Loc } from '../types';

export default function Locations() {
  const { t, sessionId, locationId, selectLocation, toast, confirm } = useApp();
  const locs = useLocations(sessionId);
  const counts = useLiveQuery(async () => {
    if (!sessionId) return new Map<string, number>();
    const recs = await db.records.where('sessionId').equals(sessionId).filter((r) => !r.voidedAt).toArray();
    const m = new Map<string, number>();
    recs.forEach((r) => m.set(r.locationId, (m.get(r.locationId) ?? 0) + 1));
    return m;
  }, [sessionId]);

  const [zoneName, setZoneName] = useState('');
  const [shelfFor, setShelfFor] = useState<string | null>(null);
  const [shelfName, setShelfName] = useState('');
  const [bulk, setBulk] = useState({ prefix: 'Rayon', count: '10' });
  const [rename, setRename] = useState<{ kind: 'zone' | 'shelf'; zone: string; loc?: Loc; value: string } | null>(null);

  const grouped = useMemo(() => {
    const m = new Map<string, Loc[]>();
    (locs ?? []).forEach((l) => m.set(l.zone, [...(m.get(l.zone) ?? []), l]));
    return [...m.entries()];
  }, [locs]);

  if (!sessionId)
    return (
      <Shell title={t('nav.locations')} back="/more">
        <Empty icon="layers" title={t('home.noSession')} action={<Btn variant="primary" onClick={() => go('/sessions')}>{t('sessions')}</Btn>} />
      </Shell>
    );

  const done = (locs ?? []).filter((l) => l.completed).length;

  const addZone = async () => {
    if (!zoneName.trim()) return;
    await addLocation(sessionId, zoneName);
    setZoneName('');
  };
  const addShelf = async () => {
    if (!shelfFor || !shelfName.trim()) return;
    await addLocation(sessionId, shelfFor, shelfName);
    setShelfName('');
  };
  const addBulk = async () => {
    const n = parseInt(bulk.count, 10);
    if (!shelfFor || !(n >= 1 && n <= 200)) return;
    const added = await addShelvesBulk(sessionId, shelfFor, bulk.prefix, n);
    toast(t('loc.bulkAdded', { n: added }));
    setShelfFor(null);
  };
  const doRename = async () => {
    if (!rename || !rename.value.trim()) return;
    if (rename.kind === 'zone') await renameZone(sessionId, rename.zone, rename.value);
    else if (rename.loc) await renameShelf(rename.loc.id, rename.value);
    setRename(null);
  };
  const remove = async (l: Loc) => {
    if (!(await confirm({ message: t('loc.deleteConfirm'), danger: true, confirmLabel: t('delete') }))) return;
    const ok = await deleteLocationIfEmpty(l.id);
    if (!ok) toast(t('loc.deleteBlocked'), 'err');
    else if (l.id === locationId) selectLocation(null);
  };

  return (
    <Shell title={t('nav.locations')} back="/more">
      <Page>
        <Card className="space-y-3">
          <div className="flex items-center justify-between text-sm text-white/60">
            <span>{t('stat.locations')}</span>
            <b className="text-white">
              {done}/{locs?.length ?? 0}
            </b>
          </div>
          <div className="flex gap-2">
            <Input value={zoneName} onChange={(e) => setZoneName(e.target.value)} placeholder={t('loc.zonePlaceholder')} onKeyDown={(e) => e.key === 'Enter' && addZone()} />
            <Btn variant="primary" className="shrink-0" onClick={addZone} disabled={!zoneName.trim()}>
              <Icon name="plus" />
            </Btn>
          </div>
        </Card>

        {!locs ? null : grouped.length === 0 ? (
          <Empty icon="pin" title={t('loc.none')} text={t('loc.noneHelp')} />
        ) : (
          grouped.map(([zone, items]) => (
            <Card key={zone} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-lg font-bold">{zone}</p>
                <div className="flex gap-2">
                  <Btn className="!min-h-11 !px-3" onClick={() => setRename({ kind: 'zone', zone, value: zone })} aria-label={t('rename')}>
                    <Icon name="edit" className="h-5 w-5" />
                  </Btn>
                  <Btn className="!min-h-11 !px-3" onClick={() => { setShelfFor(zone); setShelfName(''); }}>
                    <Icon name="plus" className="h-5 w-5" /> {t('loc.shelf')}
                  </Btn>
                </div>
              </div>
              {items.map((l) => (
                <div key={l.id} className={`flex items-center gap-2 rounded-xl border p-2 ${l.id === locationId ? 'border-accent bg-accent/10' : 'border-line bg-panel2'}`}>
                  <button className="min-w-0 flex-1 text-start" onClick={() => { selectLocation(l.id); go('/scan'); }}>
                    <p className="truncate font-medium">{l.shelf || t('loc.zoneItself')}</p>
                    <p className="text-xs text-white/40">
                      {counts?.get(l.id) ?? 0} {t('stat.records').toLowerCase()}
                    </p>
                  </button>
                  {l.completed && <Badge tone="ok">{t('loc.done')}</Badge>}
                  <Btn className="!min-h-11 !px-3" onClick={() => setCompleted(l.id, !l.completed)} aria-label={t('loc.markDone')}>
                    <Icon name="check" className={`h-5 w-5 ${l.completed ? 'text-emerald-300' : ''}`} />
                  </Btn>
                  {l.shelf && (
                    <Btn className="!min-h-11 !px-3" onClick={() => setRename({ kind: 'shelf', zone, loc: l, value: l.shelf })} aria-label={t('rename')}>
                      <Icon name="edit" className="h-5 w-5" />
                    </Btn>
                  )}
                  <Btn className="!min-h-11 !px-3" onClick={() => remove(l)} aria-label={t('delete')}>
                    <Icon name="trash" className="h-5 w-5" />
                  </Btn>
                </div>
              ))}
            </Card>
          ))
        )}
      </Page>

      <Sheet open={!!shelfFor} onClose={() => setShelfFor(null)} title={`${t('loc.addShelves')} — ${shelfFor}`}>
        <div className="space-y-5">
          <div className="flex gap-2">
            <Input value={shelfName} onChange={(e) => setShelfName(e.target.value)} placeholder="Rayon 01" onKeyDown={(e) => e.key === 'Enter' && addShelf()} />
            <Btn variant="primary" onClick={addShelf} disabled={!shelfName.trim()}>
              <Icon name="plus" />
            </Btn>
          </div>
          <div className="space-y-2 rounded-2xl border border-line p-3">
            <p className="text-sm font-semibold">{t('loc.bulk')}</p>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t('loc.prefix')}>
                <Input value={bulk.prefix} onChange={(e) => setBulk({ ...bulk, prefix: e.target.value })} />
              </Field>
              <Field label={t('loc.count')}>
                <Input inputMode="numeric" value={bulk.count} onChange={(e) => setBulk({ ...bulk, count: e.target.value.replace(/\D/g, '') })} />
              </Field>
            </div>
            <Btn variant="primary" className="w-full" onClick={addBulk}>
              {t('loc.bulkCreate')}
            </Btn>
          </div>
        </div>
      </Sheet>

      <Sheet open={!!rename} onClose={() => setRename(null)} title={t('rename')}>
        {rename && (
          <div className="space-y-3">
            <Input value={rename.value} onChange={(e) => setRename({ ...rename, value: e.target.value })} autoFocus />
            <Btn variant="primary" className="w-full" onClick={doRename}>
              {t('save')}
            </Btn>
          </div>
        )}
      </Sheet>
    </Shell>
  );
}
