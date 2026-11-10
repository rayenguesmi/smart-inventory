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
import { buildCsvString, formatDateTimeIso, triggerCsvDownload, formatDateYmd } from '../lib/csvManager';

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

  const exportHistoryCsv = (recordsToExport: CountRecord[], label = 'filtered') => {
    if (!data || !recordsToExport.length) return;
    const headers = [
      'Date',
      'Movement Type',
      'Product Name',
      'Reference',
      'Barcode',
      'Zone',
      'Shelf',
      'Quantity',
      'Unit',
      'Status',
    ];
    const rows = recordsToExport.map((r) => {
      const p = data.products.get(r.productId);
      const l = locMap.get(r.locationId);
      const status = r.voidedAt
        ? r.supersededBy ? 'Corrigé' : 'Annulé'
        : r.supersedes ? 'Correction' : 'Valide';
      const typeStr = r.type === 'in' ? 'Stock IN (+)' : r.type === 'out' ? 'Stock OUT (−)' : r.type === 'opening' ? 'Opening Balance' : 'Count';
      return [
        formatDateTimeIso(r.createdAt),
        typeStr,
        p?.name ?? '—',
        p?.reference ?? '',
        p?.internalBarcode || p?.barcode || '',
        l?.zone ?? '',
        l?.shelf ?? '',
        r.qty,
        r.unit,
        status,
      ];
    });

    const csv = buildCsvString(headers, rows, ';', true);
    triggerCsvDownload(`SMART_INVENTORY_HISTORY_${label.toUpperCase()}_${formatDateYmd()}.csv`, csv);
    toast(settings.lang === 'ar' ? 'تم تصدير سجل الحركات CSV ✓' : 'Historique exporté en CSV ✓');
  };

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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex min-h-10 items-center gap-2 text-xs text-white/70">
                <input type="checkbox" className="h-4 w-4 accent-[#2f7bff]" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
                {t('history.showVoided')}
              </label>
              <div className="flex gap-1.5">
                <Btn onClick={() => exportHistoryCsv(list, 'filtered')} disabled={!list.length} className="!min-h-8 !px-2.5 text-xs">
                  <Icon name="download" className="h-3.5 w-3.5" />
                  {settings.lang === 'ar' ? `تصدير المفلتر (${list.length})` : `Export (${list.length})`}
                </Btn>
                <Btn onClick={() => exportHistoryCsv(data.records, 'all')} disabled={!data.records.length} className="!min-h-8 !px-2.5 text-xs">
                  <Icon name="download" className="h-3.5 w-3.5" />
                  {settings.lang === 'ar' ? 'تصدير الكل' : 'Tout exporter'}
                </Btn>
              </div>
            </div>
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
                            <p className={`text-xl font-bold ${r.voidedAt ? 'line-through' : r.type === 'out' ? 'text-amber-400' : ''}`}>
                              {r.type === 'out' ? `-${fmtNum(r.qty)}` : fmtNum(r.qty)} <span className="text-sm font-normal text-white/50">{unitLabel(r.unit)}</span>
                            </p>
                            {r.type === 'out' && (
                              <div className="mt-0.5">
                                {r.docId ? (
                                  <button
                                    onClick={() => r.docId && go('/stock-out/' + r.docId)}
                                    className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300 underline font-mono"
                                  >
                                    <Icon name="truck" className="h-3 w-3" />
                                    {r.docNo || 'OUT'}
                                  </button>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300">
                                    <Icon name="truck" className="h-3 w-3" />
                                    Stock OUT
                                  </span>
                                )}
                              </div>
                            )}
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
