import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useApp } from '../context';
import { Shell, Page } from '../components/Shell';
import { Badge, Btn, Card, Empty, Field, Icon, Input, TextArea } from '../components/ui';
import { go } from '../router';
import { todayISO, uid } from '../lib/util';
import type { Session } from '../types';

export function SessionsPage() {
  const { t, sessionId, selectSession, toast, confirm } = useApp();
  const sessions = useLiveQuery(async () => {
    const all = await db.sessions.orderBy('createdAt').reverse().toArray();
    const counts = new Map<string, number>();
    for (const s of all) counts.set(s.id, await db.records.where('sessionId').equals(s.id).filter((r) => !r.voidedAt).count());
    return { all, counts };
  }, []);

  const setStatus = async (s: Session, status: Session['status']) => {
    await db.sessions.update(s.id, { status });
    if (status !== 'active' && s.id === sessionId) await selectSession(null);
    toast(t('session.status.' + status));
  };

  const resume = async (s: Session) => {
    await db.sessions.update(s.id, { status: 'active' });
    await selectSession(s.id);
    go('/scan');
  };

  const remove = async (s: Session) => {
    const n = await db.records.where('sessionId').equals(s.id).count();
    if (n > 0) {
      toast(t('session.deleteBlocked'), 'err');
      return;
    }
    if (!(await confirm({ message: t('session.deleteConfirm', { name: s.name }), danger: true, confirmLabel: t('delete') }))) return;
    await db.locations.where('sessionId').equals(s.id).delete();
    await db.sessions.delete(s.id);
    if (s.id === sessionId) await selectSession(null);
  };

  return (
    <Shell title={t('sessions')} back="/more" right={<Btn variant="primary" className="!min-h-12 !px-3" onClick={() => go('/session/new')}><Icon name="plus" /></Btn>}>
      <Page>
        {!sessions ? null : sessions.all.length === 0 ? (
          <Empty icon="layers" title={t('session.none')} text={t('home.noSessionHelp')} action={<Btn variant="primary" onClick={() => go('/session/new')}>{t('session.new')}</Btn>} />
        ) : (
          sessions.all.map((s) => (
            <Card key={s.id} className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-lg font-bold">
                    {s.name} {s.demo && <Badge tone="warn">DEMO</Badge>}
                  </p>
                  <p className="text-sm text-white/50">
                    {s.warehouse} · {s.date} · {sessions.counts.get(s.id) ?? 0} {t('stat.records').toLowerCase()}
                  </p>
                  {s.notes && <p className="mt-1 text-sm text-white/40">{s.notes}</p>}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge tone={s.status === 'active' ? 'ok' : s.status === 'paused' ? 'warn' : 'mute'}>{t('session.status.' + s.status)}</Badge>
                  {s.id === sessionId && <Badge>{t('session.current')}</Badge>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {s.id !== sessionId || s.status !== 'active' ? (
                  <Btn variant="primary" onClick={() => resume(s)}>
                    {s.status === 'closed' ? t('session.reopen') : t('session.resume')}
                  </Btn>
                ) : (
                  <Btn variant="primary" onClick={() => go('/scan')}>
                    {t('nav.scan')}
                  </Btn>
                )}
                {s.status === 'active' ? <Btn onClick={() => setStatus(s, 'paused')}>{t('session.pause')}</Btn> : <Btn onClick={() => setStatus(s, 'closed')} disabled={s.status === 'closed'}>{t('session.close')}</Btn>}
                <Btn onClick={() => { selectSession(s.id).then(() => go('/locations')); }}>{t('nav.locations')}</Btn>
                <Btn onClick={() => remove(s)}>
                  <Icon name="trash" className="h-5 w-5" /> {t('delete')}
                </Btn>
              </div>
            </Card>
          ))
        )}
      </Page>
    </Shell>
  );
}

export function SessionForm() {
  const { t, selectSession, toast } = useApp();
  const [name, setName] = useState('');
  const [date, setDate] = useState(todayISO());
  const [warehouse, setWarehouse] = useState('');
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});

  const save = async () => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = t('err.required');
    if (!warehouse.trim()) e.warehouse = t('err.required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) e.date = t('err.required');
    setErr(e);
    if (Object.keys(e).length) return;
    const s: Session = { id: uid(), name: name.trim(), date, warehouse: warehouse.trim(), notes: notes.trim() || undefined, status: 'active', createdAt: Date.now() };
    await db.sessions.add(s);
    await selectSession(s.id);
    toast(t('session.created'));
    go('/locations', true);
  };

  return (
    <Shell title={t('session.new')} back noNav>
      <Page>
        <Field label={t('session.name')} error={err.name}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Inventaire annuel 2026" autoFocus />
        </Field>
        <Field label={t('session.date')} error={err.date}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label={t('session.warehouse')} error={err.warehouse}>
          <Input value={warehouse} onChange={(e) => setWarehouse(e.target.value)} placeholder="Entrepôt principal" />
        </Field>
        <Field label={t('session.notes')}>
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Btn variant="primary" className="w-full !min-h-16 text-lg" onClick={save}>
          <Icon name="check" /> {t('save')}
        </Btn>
      </Page>
    </Shell>
  );
}
