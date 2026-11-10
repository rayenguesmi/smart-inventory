import { useMemo, useRef, useState, useCallback } from 'react';
import { useApp } from '../context';
import { Shell } from '../components/Shell';
import Scanner from '../components/Scanner';
import QuantitySheet from '../components/QuantitySheet';
import LocationPicker from '../components/LocationPicker';
import { Btn, Empty, Icon, Input, Sheet, Thumb } from '../components/ui';
import { findProductByCode } from '../lib/products';
import { undoLast } from '../lib/records';
import { useSessionData } from '../lib/hooks';
import { locName } from '../lib/locations';
import { fmtNum } from '../lib/util';
import { go } from '../router';
import type { Product } from '../types';

export default function Scan() {
  const { t, unitLabel, settings, sessionId, session, location, locationId, toast } = useApp();
  const data = useSessionData(sessionId);
  const [product, setProduct] = useState<Product | null>(null);
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [idle, setIdle] = useState(false); // used when continuous scanning is off
  const [manual, setManual] = useState('');
  const busy = useRef(false);

  const ready = !!sessionId && !!locationId;
  const paused = !!product || unknownCode !== null || pickerOpen || idle;

  const handleCode = useCallback(async (code: string) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const p = await findProductByCode(code);
      if (p) setProduct(p);
      else setUnknownCode(code);
    } catch {
      busy.current = false;
      toast(t('err.generic'), 'err');
    }
  }, [t, toast]);

  const release = (saved: boolean) => {
    setProduct(null);
    setUnknownCode(null);
    busy.current = false;
    if (saved && !settings.continuous) setIdle(true);
  };

  const submitManual = () => {
    const c = manual.trim();
    if (!c) return;
    setManual('');
    setIdle(false);
    handleCode(c);
  };

  const undo = async () => {
    if (!sessionId) return;
    const r = await undoLast(sessionId);
    if (!r) return toast(t('scan.nothingToUndo'), 'info');
    const p = data?.products.get(r.productId);
    toast(`${t('scan.undone')}: ${p?.name ?? ''} ${fmtNum(r.qty)} ${unitLabel(r.unit)}`, 'info');
  };

  const recent = useMemo(() => {
    if (!data) return [];
    const seen = new Set<string>();
    const out: Product[] = [];
    for (const r of [...data.records].filter((x) => !x.voidedAt).sort((a, b) => b.createdAt - a.createdAt)) {
      if (seen.has(r.productId)) continue;
      seen.add(r.productId);
      const p = data.products.get(r.productId);
      if (p && !p.mergedInto) out.push(p);
      if (out.length >= 6) break;
    }
    return out;
  }, [data]);

  if (!sessionId || !session) {
    return (
      <Shell title={t('nav.scan')}>
        <Empty icon="layers" title={t('home.noSession')} text={t('home.noSessionHelp')} action={<Btn variant="primary" onClick={() => go('/sessions')}>{t('sessions')}</Btn>} />
      </Shell>
    );
  }

  return (
    <Shell
      title={t('nav.scan')}
      right={
        <Btn className="!min-h-11 !px-3" onClick={undo} aria-label={t('undo')}>
          <Icon name="undo" className="h-5 w-5" />
          <span className="hidden min-[380px]:inline">{t('undo')}</span>
        </Btn>
      }
    >
      <div className="mx-auto w-full max-w-xl space-y-3 p-3">
        <button onClick={() => setPickerOpen(true)} className={`flex min-h-16 w-full items-center gap-3 rounded-2xl border px-4 text-start ${location ? 'border-accent/50 bg-accent/10' : 'border-amber-500/50 bg-amber-500/10'}`}>
          <Icon name="pin" className="h-6 w-6 shrink-0 text-accent2" />
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-white/50">{t('location')} · {session.name}</span>
            <span className="block truncate text-lg font-bold">{location ? locName(location) : t('loc.choose')}</span>
          </span>
          <span className="text-sm text-accent2">{t('change')}</span>
        </button>

        <div className="relative">
          <Scanner active={ready} paused={paused} onDetect={handleCode} />
          {ready && idle && !product && unknownCode === null && (
            <button onClick={() => setIdle(false)} className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-3xl bg-ink/80 text-xl font-bold">
              <Icon name="scan" className="h-14 w-14 text-accent2" />
              {t('scan.tapToScan')}
            </button>
          )}
          {!ready && (
            <button onClick={() => setPickerOpen(true)} className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-3xl bg-ink/90 text-lg font-semibold">
              <Icon name="pin" className="h-12 w-12 text-amber-300" />
              {t('scan.needLocation')}
            </button>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Btn variant="primary" className="flex-col !gap-1 !py-2 text-sm" onClick={() => setIdle(false)}>
            <Icon name="scan" /> {t('scan.barcode')}
          </Btn>
          <Btn className="flex-col !gap-1 !py-2 text-sm" onClick={() => go('/ocr')}>
            <Icon name="type" /> {t('scan.ocr')}
          </Btn>
          <Btn className="flex-col !gap-1 !py-2 text-sm" onClick={() => go('/photo')}>
            <Icon name="camera" /> {t('scan.photo')}
          </Btn>
        </div>

        <div className="flex gap-2">
          <Input value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitManual()} placeholder={t('scan.manual')} enterKeyHint="go" autoCapitalize="characters" />
          <Btn variant="primary" className="shrink-0" onClick={submitManual} disabled={!manual.trim() || !ready}>
            <Icon name="check" />
          </Btn>
        </div>

        <Btn className="w-full border-dashed" onClick={() => go('/product/new?unknown=1')} disabled={!ready}>
          <Icon name="help" /> {t('scan.unknownProduct')}
        </Btn>

        {recent.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-semibold text-white/60">{t('scan.recent')}</p>
            <div className="space-y-2">
              {recent.map((p) => (
                <button key={p.id} disabled={!ready} onClick={() => { busy.current = true; setProduct(p); }} className="card flex min-h-16 w-full items-center gap-3 !p-2 text-start disabled:opacity-50">
                  <Thumb photoId={p.photoIds[0]} className="h-12 w-12" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{p.name}</span>
                    <span className="block truncate text-xs text-white/40">{p.reference ?? p.barcode}</span>
                  </span>
                  <Icon name="plus" className="h-6 w-6 text-accent2" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {product && ready && <QuantitySheet product={product} onDone={release} onCancel={() => release(false)} />}

      <Sheet open={unknownCode !== null} onClose={() => release(false)} title={t('scan.unknownCode')}>
        <div className="space-y-4">
          <p className="break-all rounded-xl bg-panel2 p-3 text-center font-mono text-xl">{unknownCode}</p>
          <p className="text-sm text-white/60">{t('scan.unknownCodeHelp')}</p>
          <Btn variant="primary" className="w-full" onClick={() => { const c = unknownCode; release(false); go('/product/new?barcode=' + encodeURIComponent(c ?? '')); }}>
            <Icon name="plus" /> {t('scan.createProduct')}
          </Btn>
          <Btn className="w-full" onClick={() => release(false)}>
            {t('scan.rescan')}
          </Btn>
        </div>
      </Sheet>

      <LocationPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </Shell>
  );
}
