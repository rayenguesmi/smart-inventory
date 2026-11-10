import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useApp } from '../context';
import { Shell, Page } from '../components/Shell';
import FilterBar from '../components/FilterBar';
import { Badge, Btn, Empty, Field, Icon, Input, Select, Sheet } from '../components/ui';
import { EMPTY_FILTERS, filterRecords, type Filters } from '../lib/filters';
import { useSessionData } from '../lib/hooks';
import { correctRecord, restoreRecord, voidRecord } from '../lib/records';
import { locName } from '../lib/locations';
import { fmtDateTime, fmtNum } from '../lib/util';
import { DECIMAL_UNITS, UNITS, type CountRecord, type Unit } from '../types';
import { go } from '../router';

/** Screen 11: inventory history of a session, with filters, correction, void and restore. Nothing is ever deleted. */
export default function History() {
  const { t, unitLabel, settings, sessionId, selectSession, toast, confirm } = useApp();
  const sessions = useLiveQuery(() => db.sessions.orderBy('createdAt').reverse().toArray(), []);
  const data = useSessionData(sessionId);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showVoided, setShowVoided] = useState(false);
  const [limit, setLimit] = useState(100);
  const [edit, setEdit] = useState<{ rec: CountRecord; qty: string; unit: Unit } | null>(null);

  const list = useMemo(() => {
    if (!data) return [];
    return filterRecords(data, filters)
      .filter((r) => showVoided || !r.voidedAt)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [data, filters, showVoided]);
  const locMap = new Map((data?.locations ?? []).map((l) => [l.id, l]));

  const saveEdit = async () => {
    if (!edit) return;
    const q = Number(edit.qty);
    try {
      await correctRecord(edit.rec.id, q, edit.unit);
      toast(t('history.corrected'));
      setEdit(null);
    } catch {
      toast(t('err.BAD_QTY'), 'err');
    }
  };

  const doVoid = async (r: CountRecord) => {
    if (!(await confirm({ message: t('history.voidConfirm'), confirmLabel: t('history.void'), danger: true }))) return;
    await voidRecord(r.id);
    toast(t('history.voided'), 'info', { label: t('history.restore'), fn: () => restoreRecord(r.id) });
  };

  return (
    <Shell title={t('nav.history')}>
      <Page>
        <Select
          value={sessionId ?? ''}
          onChange={async (e) => {
            await selectSession(e.target.value || null);
            setFilters(EMPTY_FILTERS);
          }}
        >
          <option value="">{t('history.pickSession')}</option>
          {(sessions ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} — {s.date}
            </option>
          ))}
        </Select>

        {!sessionId ? (
          <Empty icon="clock" title={t('home.noSession')} action={<Btn variant="primary" onClick={() => go('/sessions')}>{t('sessions')}</Btn>} />
        ) : !data ? null : (
          <>
            <FilterBar locations={data.locations} value={filters} onChange={setFilters} />
            <label className="flex min-h-12 items-center gap-3 text-sm text-white/70">
              <input type="checkbox" className="h-5 w-5 accent-[#2f7bff]" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
              {t('history.showVoided')}
            </label>
            {list.length === 0 ? (
              <Empty icon="clock" title={t('history.empty')} />
            ) : (
              <>
                <p className="text-xs text-white/40">
                  {list.length} {t('stat.records').toLowerCase()}
                </p>
                <div className="space-y-2">
                  {list.slice(0, limit).map((r) => {
                    const p = data.products.get(r.productId);
                    const l = locMap.get(r.locationId);
                    return (
                      <div key={r.id} className={`card space-y-2 !p-3 ${r.voidedAt ? 'opacity-60' : ''}`}>
                        <div className="flex items-start justify-between gap-3">
                          <button className="min-w-0 text-start" onClick={() => p && go('/p/' + p.id)}>
                            <p className="truncate font-medium">{p?.name ?? '—'}</p>
                            <p className="truncate text-xs text-white/40">
                              {p?.reference ?? p?.barcode ?? ''} · {l ? locName(l) : '—'}
                            </p>
                            <p className="text-xs text-white/40">{fmtDateTime(r.createdAt, settings.lang)}</p>
                          </button>
                          <div className="shrink-0 text-end">
                            <p className={`text-xl font-bold ${r.voidedAt ? 'line-through' : ''}`}>
                              {fmtNum(r.qty)} <span className="text-sm font-normal text-white/50">{unitLabel(r.unit)}</span>
                            </p>
                            {r.supersedes && !r.voidedAt && <Badge>{t('history.correction')}</Badge>}
                            {r.voidedAt && <Badge tone="mute">{r.supersededBy ? t('history.corrected') : t('history.voided')}</Badge>}
                          </div>
                        </div>
                        {!r.voidedAt ? (
                          <div className="grid grid-cols-2 gap-2">
                            <Btn className="!min-h-11 text-sm" onClick={() => setEdit({ rec: r, qty: String(r.qty), unit: r.unit })}>
                              <Icon name="edit" className="h-4 w-4" /> {t('history.correct')}
                            </Btn>
                            <Btn className="!min-h-11 text-sm" onClick={() => doVoid(r)}>
                              <Icon name="x" className="h-4 w-4" /> {t('history.void')}
                            </Btn>
                          </div>
                        ) : (
                          !r.supersededBy && (
                            <Btn className="!min-h-11 w-full text-sm" onClick={() => restoreRecord(r.id)}>
                              <Icon name="undo" className="h-4 w-4" /> {t('history.restore')}
                            </Btn>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
                {list.length > limit && (
                  <Btn className="w-full" onClick={() => setLimit((n) => n + 100)}>
                    {t('showMore')} ({list.length - limit})
                  </Btn>
                )}
              </>
            )}
          </>
        )}
      </Page>

      <Sheet open={!!edit} onClose={() => setEdit(null)} title={t('history.correct')}>
        {edit && (
          <div className="space-y-4">
            <p className="text-sm text-white/60">{t('history.correctHelp')}</p>
            <Field label={t('qty')}>
              <Input
                inputMode="decimal"
                value={edit.qty}
                onChange={(e) => {
                  const v = e.target.value.replace(',', '.');
                  const re = DECIMAL_UNITS.includes(edit.unit) ? /^\d{0,9}(\.\d{0,3})?$/ : /^\d{0,9}$/;
                  if (re.test(v)) setEdit({ ...edit, qty: v });
                }}
                className="!min-h-16 text-center text-3xl font-bold"
                autoFocus
              />
            </Field>
            <Field label={t('unit')}>
              <Select value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value as Unit, qty: DECIMAL_UNITS.includes(e.target.value as Unit) ? edit.qty : String(Math.floor(Number(edit.qty) || 0)) })}>
                {UNITS.map((u) => (
                  <option key={u} value={u}>
                    {unitLabel(u)}
                  </option>
                ))}
              </Select>
            </Field>
            <Btn variant="primary" className="w-full" disabled={edit.qty === ''} onClick={saveEdit}>
              <Icon name="check" /> {t('save')}
            </Btn>
          </div>
        )}
      </Sheet>
    </Shell>
  );
}
