import { useMemo, useState } from 'react';
import { useApp } from '../context';
import { useLocations } from '../lib/hooks';
import { addLocation, locName, setCompleted } from '../lib/locations';
import { go } from '../router';
import { Badge, Btn, Empty, Icon, Input, Sheet } from './ui';

export default function LocationPicker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, sessionId, locationId, selectLocation, toast } = useApp();
  const locs = useLocations(sessionId);
  const [q, setQ] = useState('');
  const list = useMemo(() => (locs ?? []).filter((l) => locName(l).toLowerCase().includes(q.trim().toLowerCase())), [locs, q]);
  const current = locs?.find((l) => l.id === locationId);

  const quickAdd = async () => {
    if (!sessionId || !q.trim()) return;
    const [zone, ...rest] = q.split('/').map((s) => s.trim());
    const loc = await addLocation(sessionId, zone, rest.join(' / '));
    selectLocation(loc.id);
    setQ('');
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('loc.pick')}>
      <div className="space-y-3">
        {current && (
          <Btn
            variant={current.completed ? 'ghost' : 'ok'}
            className="w-full"
            onClick={async () => {
              await setCompleted(current.id, !current.completed);
              toast(current.completed ? t('loc.reopened') : t('loc.markedDone'));
            }}
          >
            <Icon name="check" /> {current.completed ? t('loc.reopen') : t('loc.markDone')} — {locName(current)}
          </Btn>
        )}
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('loc.searchOrCreate')} />
        {q.trim() && !list.some((l) => locName(l).toLowerCase() === q.trim().toLowerCase()) && (
          <Btn variant="primary" className="w-full" onClick={quickAdd}>
            <Icon name="plus" /> {t('loc.create')}: {q.trim()}
          </Btn>
        )}
        {!locs?.length && !q && (
          <Empty icon="pin" title={t('loc.none')} text={t('loc.noneHelp')} action={<Btn variant="primary" onClick={() => { onClose(); go('/locations'); }}>{t('loc.manage')}</Btn>} />
        )}
        <div className="space-y-2">
          {list.map((l) => (
            <button
              key={l.id}
              onClick={() => {
                selectLocation(l.id);
                onClose();
              }}
              className={`flex min-h-14 w-full items-center justify-between rounded-2xl border px-4 text-start text-base ${l.id === locationId ? 'border-accent bg-accent/10' : 'border-line bg-panel2'}`}
            >
              <span>{locName(l)}</span>
              {l.completed && <Badge tone="ok">{t('loc.done')}</Badge>}
            </button>
          ))}
        </div>
        {!!locs?.length && (
          <Btn className="w-full" onClick={() => { onClose(); go('/locations'); }}>
            {t('loc.manage')}
          </Btn>
        )}
      </div>
    </Sheet>
  );
}
