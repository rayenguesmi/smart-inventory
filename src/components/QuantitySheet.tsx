import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useApp } from '../context';
import { DECIMAL_UNITS, UNITS, type Product, type Unit } from '../types';
import { addRecord, fmtTotals, pieceEquivalent, sumByUnit, undoLast } from '../lib/records';
import { usePhotoUrl } from '../lib/image';
import { fmtNum } from '../lib/util';
import { locName } from '../lib/locations';
import { Icon, Sheet } from './ui';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'];

/** Fast quantity entry: big keypad, +/-, unit chips, one tap to confirm. */
export default function QuantitySheet({ product, onDone, onCancel }: { product: Product; onDone: (saved: boolean) => void; onCancel: () => void }) {
  const { t, unitLabel, sessionId, location, locationId, toast } = useApp();
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState<Unit>(product.unit);
  const [saving, setSaving] = useState(false);
  const photo = usePhotoUrl(product.photoIds[0]);
  const decimal = DECIMAL_UNITS.includes(unit);

  const here = useLiveQuery(async () => {
    if (!sessionId || !locationId) return {};
    const recs = await db.records.where('productId').equals(product.id).filter((r) => r.sessionId === sessionId && r.locationId === locationId).toArray();
    return sumByUnit(recs);
  }, [product.id, sessionId, locationId]);

  const num = value === '' ? NaN : parseFloat(value);
  const valid = Number.isFinite(num) && num >= 0 && (decimal || Number.isInteger(num));
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
      const rec = await addRecord({ sessionId, locationId, productId: product.id, qty: num, unit });
      toast(`✓ ${product.name} — ${fmtNum(rec.qty)} ${unitLabel(unit)}`, 'ok', {
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
      <div className="mx-auto flex h-full max-w-md flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-panel2">
            {photo ? <img src={photo} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-white/20"><Icon name="image" className="h-8 w-8" /></div>}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold leading-tight">{product.name}</p>
            <p className="truncate text-sm text-white/60">
              {t('ref')}: {product.reference ?? '—'}
              {product.barcode ? ` · ${product.barcode}` : ''}
            </p>
            <p className="flex items-center gap-1 truncate text-sm text-accent2">
              <Icon name="pin" className="h-4 w-4" /> {location ? locName(location) : '—'}
            </p>
          </div>
          <button onClick={onCancel} aria-label={t('cancel')} className="h-12 w-12 rounded-xl text-white/60 active:bg-line">
            <Icon name="x" className="mx-auto" />
          </button>
        </div>

        {here && Object.keys(here).length > 0 && (
          <div className="rounded-xl bg-accent/10 px-3 py-2 text-sm text-accent2">
            {t('qty.alreadyHere')}: <b>{fmtTotals(here, unitLabel)}</b>
          </div>
        )}

        <div className="flex items-stretch gap-2">
          <button className="btn btn-ghost !min-h-16 w-20 text-3xl" onClick={() => step(-1)} aria-label="−1">
            <Icon name="minus" className="h-8 w-8" />
          </button>
          <input
            value={value}
            onChange={(e) => onInput(e.target.value)}
            inputMode="decimal"
            placeholder="0"
            aria-label={t('qty')}
            className="input !min-h-16 flex-1 text-center text-4xl font-bold tabular-nums"
          />
          <button className="btn btn-ghost !min-h-16 w-20" onClick={() => step(1)} aria-label="+1">
            <Icon name="plus" className="h-8 w-8" />
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1">
          {UNITS.map((u) => (
            <button key={u} onClick={() => changeUnit(u)} className={`chip !px-4 !py-2.5 text-base ${unit === u ? '!border-accent !bg-accent/20 text-white' : 'text-white/60'}`}>
              {unitLabel(u)}
            </button>
          ))}
        </div>
        {eq !== undefined && (
          <p className="text-sm text-white/60">
            1 {unitLabel('carton')} = {product.cartonQty} {unitLabel('piece')} → {fmtNum(eq)} {unitLabel('piece')}
          </p>
        )}
        {unit === 'carton' && !product.cartonQty && <p className="text-xs text-white/40">{t('qty.noConversion')}</p>}

        <div className="grid flex-1 grid-cols-3 gap-2">
          {KEYS.map((k) => (
            <button
              key={k}
              onClick={() => press(k)}
              disabled={k === '.' && !decimal}
              className="btn btn-ghost !min-h-14 text-2xl font-semibold disabled:opacity-20"
              aria-label={k === 'back' ? 'backspace' : k}
            >
              {k === 'back' ? <Icon name="backspace" /> : k}
            </button>
          ))}
        </div>

        <button onClick={confirm} disabled={!valid || saving} className="btn btn-ok !min-h-16 text-xl">
          <Icon name="check" className="h-7 w-7" /> {t('qty.confirm')}
        </button>
      </div>
    </Sheet>
  );
}
