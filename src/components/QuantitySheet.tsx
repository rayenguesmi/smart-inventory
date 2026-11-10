import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useApp } from '../context';
import { DECIMAL_UNITS, UNITS, type MovementType, type Product, type Unit } from '../types';
import { addRecord, fmtTotals, pieceEquivalent, sumByUnit, undoLast } from '../lib/records';
import { usePhotoUrl } from '../lib/image';
import { fmtNum } from '../lib/util';
import { locName } from '../lib/locations';
import { go } from '../router';
import { Btn, Icon, Sheet } from './ui';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];

/** Fast quantity entry: big keypad, +/-, unit chips, Stock IN / OUT / Count selector, one tap to confirm. */
export default function QuantitySheet({ product, onDone, onCancel }: { product: Product; onDone: (saved: boolean) => void; onCancel: () => void }) {
  const { t, unitLabel, settings, sessionId, location, locationId, toast } = useApp();
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState<Unit>(product.unit);
  const [mode, setMode] = useState<MovementType>('count');
  const [saving, setSaving] = useState(false);
  const photo = usePhotoUrl(product.photoIds[0]);
  const decimal = DECIMAL_UNITS.includes(unit);

  const here = useLiveQuery(async () => {
    if (!sessionId || !locationId) return {};
    const recs = await db.records.where('productId').equals(product.id).filter((r) => r.sessionId === sessionId && r.locationId === locationId).toArray();
    return sumByUnit(recs);
  }, [product.id, sessionId, locationId]);

  const num = value === '' ? NaN : parseFloat(value);
  const valid = Number.isFinite(num) && num > 0 && (decimal || Number.isInteger(num));
  const eq = valid ? pieceEquivalent(product, unit, num) : undefined;

  const press = (k: string) => {
    setValue((v) => {
      if (k === 'back') return v.slice(0, -1);
      if (k === '.') return decimal && !v.includes('.') ? (v === '' ? '0.' : v + '.') : v;
      if (v === '0') return k;
      if (v.replace('.', '').length >= 9) return v;
      if (v.includes('.') && v.split('.')[1].length >= 3) return v;
      return v + k;
    });
  };
  const step = (d: number) => setValue((v) => {
    const cur = v === '' ? 0 : parseFloat(v) || 0;
    return String(Math.max(0, Math.round((cur + d) * 1000) / 1000));
  });

  const onInput = (raw: string) => {
    const re = decimal ? /^\d{0,9}([.,]\d{0,3})?$/ : /^\d{0,9}$/;
    if (re.test(raw)) setValue(raw.replace(',', '.'));
  };

  const changeUnit = (u: Unit) => {
    setUnit(u);
    if (!DECIMAL_UNITS.includes(u)) setValue((v) => (v.includes('.') ? String(Math.floor(parseFloat(v) || 0)) : v));
  };

  const confirm = async () => {
    if (!valid || saving || !sessionId || !locationId) return;
    setSaving(true);
    try {
      const rec = await addRecord({ sessionId, locationId, productId: product.id, qty: num, unit, type: mode });
      const prefix = mode === 'in' ? '[Stock IN +]' : mode === 'out' ? '[Stock OUT −]' : '[Count]';
      toast(`✓ ${prefix} ${product.name} — ${fmtNum(rec.qty)} ${unitLabel(unit)}`, 'ok', {
        label: t('undo'),
        fn: async () => {
          await undoLast(sessionId);
        },
      });
      onDone(true);
    } catch {
      toast(t('err.BAD_QTY'), 'err');
      setSaving(false);
    }
  };

  return (
    <Sheet open onClose={onCancel} full>
      <div className="mx-auto flex h-full max-w-md flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-panel2">
            {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-white/20"><Icon name="image" className="h-7 w-7" /></div>}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold leading-tight">{product.name}</p>
            <p className="truncate text-xs text-white/60">
              {product.reference ? `RÉF: ${product.reference} · ` : ''}
              <span className="font-mono text-accent2">{product.internalBarcode || product.barcode || '—'}</span>
            </p>
            <p className="flex items-center gap-1 truncate text-xs text-accent2">
              <Icon name="pin" className="h-3.5 w-3.5" /> {location ? locName(location) : '—'}
            </p>
          </div>
          <Btn
            className="!min-h-9 !px-2 text-xs"
            onClick={() => {
              onCancel();
              go('/p/' + product.id);
            }}
          >
            <Icon name="box" className="h-4 w-4" />
          </Btn>
          <button onClick={onCancel} aria-label={t('cancel')} className="h-10 w-10 rounded-xl text-white/60 active:bg-line">
            <Icon name="x" className="mx-auto" />
          </button>
        </div>

        {/* Operation Mode Selector: Count, Stock IN, Stock OUT */}
        <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-panel2 p-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setMode('count')}
            className={`rounded-lg py-2 transition ${mode === 'count' ? 'bg-accent2 text-ink shadow' : 'text-white/60'}`}
          >
            {settings.lang === 'ar' ? 'جرد (Count)' : 'Comptage'}
          </button>
          <button
            type="button"
            onClick={() => setMode('in')}
            className={`rounded-lg py-2 transition ${mode === 'in' ? 'bg-emerald-500 text-ink shadow' : 'text-white/60'}`}
          >
            + {settings.lang === 'ar' ? 'دخول (IN)' : 'Entrée'}
          </button>
          <button
            type="button"
            onClick={() => setMode('out')}
            className={`rounded-lg py-2 transition ${mode === 'out' ? 'bg-amber-500 text-ink shadow' : 'text-white/60'}`}
          >
            − {settings.lang === 'ar' ? 'خروج (OUT)' : 'Sortie'}
          </button>
        </div>

        {here && Object.keys(here).length > 0 && (
          <div className="rounded-xl bg-accent/10 px-3 py-1.5 text-xs text-accent2">
            {t('qty.alreadyHere')}: <b>{fmtTotals(here, unitLabel)}</b>
          </div>
        )}

        <div className="flex items-stretch gap-2">
          <button className="btn btn-ghost !min-h-14 w-16 text-3xl" onClick={() => step(-1)} aria-label="−1">
            <Icon name="minus" className="h-7 w-7" />
          </button>
          <input
            value={value}
            onChange={(e) => onInput(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            aria-label={t('qty')}
            className="input !min-h-14 flex-1 text-center text-3xl font-bold tabular-nums"
          />
          <button className="btn btn-ghost !min-h-14 w-16" onClick={() => step(1)} aria-label="+1">
            <Icon name="plus" className="h-7 w-7" />
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {UNITS.map((u) => (
            <button key={u} onClick={() => changeUnit(u)} className={`chip !px-3 !py-1.5 text-sm ${unit === u ? '!border-accent !bg-accent/20 text-white' : 'text-white/60'}`}>
              {unitLabel(u)}
            </button>
          ))}
        </div>
        {eq !== undefined && (
          <p className="text-xs text-white/60">
            1 {unitLabel('carton')} = {product.cartonQty} {unitLabel('piece')} → {fmtNum(eq)} {unitLabel('piece')}
          </p>
        )}
        {unit === 'carton' && !product.cartonQty && <p className="text-xs text-white/40">{t('qty.noConversion')}</p>}

        <div className="grid flex-1 grid-cols-3 gap-1.5">
          {KEYS.map((k) => (
            <button
              key={k}
              onClick={() => press(k)}
              disabled={k === '.' && !decimal}
              className="btn btn-ghost !min-h-12 text-xl font-semibold disabled:opacity-20"
              aria-label={k === 'back' ? 'backspace' : k}
            >
              {k === 'back' ? <Icon name="backspace" /> : k}
            </button>
          ))}
        </div>

        <button
          onClick={confirm}
          disabled={!valid || saving}
          className={`btn !min-h-14 text-lg font-bold ${
            mode === 'out' ? 'bg-amber-500 text-ink' : mode === 'in' ? 'bg-emerald-500 text-ink' : 'btn-ok'
          }`}
        >
          <Icon name="check" className="h-6 w-6" />
          {mode === 'in'
            ? settings.lang === 'ar' ? 'تأكيد دخول المخزون' : 'Confirmer entrée de stock'
            : mode === 'out'
            ? settings.lang === 'ar' ? 'تأكيد خروج المخزون' : 'Confirmer sortie de stock'
            : t('qty.confirm')}
        </button>
      </div>
    </Sheet>
  );
}
