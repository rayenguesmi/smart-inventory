import { useEffect, useState } from 'react';
import { useApp } from '../context';
import { Shell, Page } from '../components/Shell';
import PhotoButton from '../components/PhotoButton';
import { Badge, Btn, Card, Field, Icon, Input, Spinner, TextArea } from '../components/ui';
import { savePhoto } from '../lib/image';
import { runOcr, type OcrResult } from '../lib/ocr';
import { setDraft } from '../lib/draft';
import { findProductByCode } from '../lib/products';
import QuantitySheet from '../components/QuantitySheet';
import { go } from '../router';
import type { Product } from '../types';

/** Screen 6: photograph a product that has no label. */
export function PhotoCapture() {
  const { t, sessionId, locationId } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onFile = async (f: File) => {
    setBusy(true);
    setError('');
    try {
      const id = await savePhoto(f);
      setDraft({ photoIds: [id], unknown: true });
      go('/product/new?unknown=1&draft=1', true);
    } catch {
      setError(t('err.photo'));
      setBusy(false);
    }
  };

  return (
    <Shell title={t('photo.title')} back="/scan" noNav>
      <Page>
        {!sessionId || !locationId ? (
          <Card className="text-center text-amber-200">{t('scan.needLocation')}</Card>
        ) : null}
        <Card className="space-y-4 text-center">
          <Icon name="camera" className="mx-auto h-14 w-14 text-accent2" />
          <p className="text-white/70">{t('photo.help')}</p>
          {busy ? <Spinner label={t('loading')} /> : <PhotoButton onFile={onFile} className="btn btn-primary w-full !min-h-20 text-xl"><Icon name="camera" className="h-8 w-8" /> {t('photo.take')}</PhotoButton>}
          {error && <p className="text-sm text-red-400">{error}</p>}
        </Card>
        <Card className="text-sm text-white/50">
          <p>{t('photo.noAi')}</p>
          <p className="mt-2">{t('photo.tmpHelp')}</p>
        </Card>
      </Page>
    </Shell>
  );
}

/** Screen 5: OCR of a printed label. Results are always editable and never claimed to be certain. */
export function OcrCapture() {
  const { t, sessionId, locationId } = useApp();
  const [stage, setStage] = useState<'capture' | 'working' | 'review'>('capture');
  const [progress, setProgress] = useState({ ratio: 0, status: '' });
  const [photoId, setPhotoId] = useState<string>();
  const [error, setError] = useState('');
  const [result, setResult] = useState<OcrResult | null>(null);
  const [f, setF] = useState({ reference: '', name: '', model: '', other: '' });
  const [existing, setExisting] = useState<Product | null>(null);

  useEffect(() => {
    if (!result) return;
    setF({ reference: result.reference ?? '', name: result.name ?? '', model: result.model ?? '', other: result.text });
  }, [result]);

  const onFile = async (file: File) => {
    setError('');
    setStage('working');
    setProgress({ ratio: 0, status: 'init' });
    try {
      setPhotoId(await savePhoto(file));
      setResult(await runOcr(file, (ratio, status) => setProgress({ ratio, status })));
      setStage('review');
    } catch (e: any) {
      setError(navigator.onLine ? t('ocr.failed') : t('ocr.needsInternet'));
      setStage('capture');
    }
  };

  const use = async () => {
    const ref = f.reference.trim();
    if (ref) {
      const p = await findProductByCode(ref);
      if (p) {
        setExisting(p);
        return;
      }
    }
    const desc = [f.model.trim() && `Modèle: ${f.model.trim()}`, f.other.trim()].filter(Boolean).join('\n');
    setDraft({ reference: ref || undefined, name: f.name.trim() || undefined, description: desc || undefined, photoIds: photoId ? [photoId] : [], ocrNote: '1' });
    go('/product/new?draft=1', true);
  };

  const conf = Math.round(result?.confidence ?? 0);

  return (
    <Shell title={t('ocr.title')} back="/scan" noNav>
      <Page>
        {(!sessionId || !locationId) && <Card className="text-center text-amber-200">{t('scan.needLocation')}</Card>}
        {stage === 'capture' && (
          <Card className="space-y-4 text-center">
            <Icon name="type" className="mx-auto h-14 w-14 text-accent2" />
            <p className="text-white/70">{t('ocr.help')}</p>
            <PhotoButton onFile={onFile} className="btn btn-primary w-full !min-h-20 text-xl">
              <Icon name="camera" className="h-8 w-8" /> {t('ocr.take')}
            </PhotoButton>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <p className="text-xs text-white/40">{t('ocr.firstUse')}</p>
          </Card>
        )}
        {stage === 'working' && (
          <Card className="space-y-4 text-center">
            <Spinner label={t('ocr.working')} />
            <div className="h-3 overflow-hidden rounded-full bg-panel2">
              <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.max(5, Math.round(progress.ratio * 100))}%` }} />
            </div>
            <p className="text-xs text-white/40">{progress.status}</p>
          </Card>
        )}
        {stage === 'review' && result && (
          <>
            <Card className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="font-semibold">{t('ocr.review')}</p>
                <Badge tone={conf >= 70 ? 'ok' : 'warn'}>
                  {t('ocr.confidence')}: {conf}%
                </Badge>
              </div>
              <p className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200">{t('ocr.verify')}</p>
              {!result.reference && <p className="text-sm text-white/50">{t('ocr.noRef')}</p>}
            </Card>
            <Field label={t('ref')}>
              <Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
            </Field>
            <Field label={t('product')}>
              <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            </Field>
            <Field label={t('ocr.model')}>
              <Input value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} />
            </Field>
            <Field label={t('ocr.otherText')}>
              <TextArea value={f.other} onChange={(e) => setF({ ...f, other: e.target.value })} rows={5} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Btn onClick={() => { setStage('capture'); setResult(null); }}>{t('ocr.retake')}</Btn>
              <Btn variant="primary" onClick={use} disabled={!sessionId || !locationId}>
                {t('ocr.use')}
              </Btn>
            </div>
          </>
        )}
      </Page>
      {existing && (
        <QuantitySheet
          product={existing}
          onDone={() => go('/scan', true)}
          onCancel={() => setExisting(null)}
        />
      )}
    </Shell>
  );
}
