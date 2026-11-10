import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { useApp } from '../context';
import { feedback } from '../lib/feedback';
import { Icon } from './ui';

const ZX_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.ITF,
  BarcodeFormat.CODABAR,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
  BarcodeFormat.PDF_417,
];
const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'code_93', 'itf', 'codabar', 'qr_code', 'data_matrix', 'pdf417'];

type Status = 'starting' | 'running' | 'denied' | 'unavailable' | 'error';

const constraints: MediaStreamConstraints = {
  video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  audio: false,
};

/**
 * Keeps the camera running while mounted. `paused` only gates detections, so after a quantity
 * is confirmed the next scan is instant (no camera restart). Uses the native BarcodeDetector
 * when the browser has it (Chrome/Android) and ZXing otherwise.
 */
export default function Scanner({ active, paused, onDetect }: { active: boolean; paused: boolean; onDetect: (code: string) => void }) {
  const { t, settings } = useApp();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>('starting');
  const [flash, setFlash] = useState(false);
  const [torch, setTorch] = useState({ supported: false, on: false });
  const [attempt, setAttempt] = useState(0);

  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const last = useRef({ code: '', time: 0 });

  const handle = useCallback((raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const now = Date.now();
    if (pausedRef.current) {
      // The same item is still in front of the camera after confirming: keep its cooldown alive
      // so it is not re-opened immediately.
      last.current = { code, time: now };
      return;
    }
    if (now - last.current.time < 800) return;
    if (code === last.current.code && now - last.current.time < settingsRef.current.cooldownMs) return;
    last.current = { code, time: now };
    feedback(settingsRef.current);
    setFlash(true);
    setTimeout(() => setFlash(false), 350);
    onDetectRef.current(code);
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const cleanups: Array<() => void> = [];
    const video = videoRef.current;

    (async () => {
      setStatus('starting');
      if (!navigator.mediaDevices?.getUserMedia || !video) {
        setStatus('unavailable');
        return;
      }
      try {
        const BD = (window as any).BarcodeDetector;
        let detector: any = null;
        if (BD) {
          try {
            const supported: string[] = await BD.getSupportedFormats();
            const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
            if (formats.length) detector = new BD({ formats });
          } catch {
            detector = null;
          }
        }

        if (detector) {
          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (cancelled) {
            stream.getTracks().forEach((tr) => tr.stop());
            return;
          }
          cleanups.push(() => stream.getTracks().forEach((tr) => tr.stop()));
          video.srcObject = stream;
          await video.play();
          let busy = false;
          const timer = window.setInterval(async () => {
            if (busy || video.readyState < 2) return;
            busy = true;
            try {
              const found = await detector.detect(video);
              if (found.length) handle(found[0].rawValue);
            } catch {
              /* frame not decodable */
            }
            busy = false;
          }, 100);
          cleanups.push(() => window.clearInterval(timer));
        } else {
          const hints = new Map<DecodeHintType, unknown>();
          hints.set(DecodeHintType.POSSIBLE_FORMATS, ZX_FORMATS);
          hints.set(DecodeHintType.TRY_HARDER, true);
          const reader = new BrowserMultiFormatReader(hints as Map<DecodeHintType, any>, { delayBetweenScanAttempts: 90 });
          const controls = await reader.decodeFromConstraints(constraints, video, (result) => {
            if (result) handle(result.getText());
          });
          if (cancelled) {
            controls.stop();
            return;
          }
          cleanups.push(() => controls.stop());
        }

        const track = (video.srcObject as MediaStream | null)?.getVideoTracks?.()[0];
        const caps: any = track?.getCapabilities?.() ?? {};
        setTorch({ supported: !!caps.torch, on: false });
        setStatus('running');
      } catch (e: any) {
        if (cancelled) return;
        const n = e?.name ?? '';
        if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') setStatus('denied');
        else if (n === 'NotFoundError' || n === 'OverconstrainedError' || n === 'DevicesNotFoundError') setStatus('unavailable');
        else setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      cleanups.forEach((c) => {
        try {
          c();
        } catch {
          /* ignore */
        }
      });
      if (video) video.srcObject = null;
    };
  }, [active, attempt, handle]);

  const toggleTorch = async () => {
    const track = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks?.()[0];
    if (!track) return;
    const next = !torch.on;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as any] });
      setTorch((s) => ({ ...s, on: next }));
    } catch {
      setTorch({ supported: false, on: false });
    }
  };

  const failed = status === 'denied' || status === 'unavailable' || status === 'error';

  return (
    <div className="relative aspect-[4/3] w-full overflow-hidden rounded-3xl border border-line bg-black">
      <video ref={videoRef} className="h-full w-full object-cover" muted playsInline autoPlay />
      {status === 'running' && (
        <>
          <div className={`pointer-events-none absolute inset-x-6 top-1/2 h-28 -translate-y-1/2 rounded-2xl border-2 transition-colors ${flash ? 'border-emerald-400 bg-emerald-400/10' : 'border-accent/70'}`} />
          {torch.supported && (
            <button onClick={toggleTorch} aria-label={t('torch')} className={`absolute end-3 top-3 flex h-12 w-12 items-center justify-center rounded-full ${torch.on ? 'bg-amber-400 text-black' : 'bg-black/60 text-white'}`}>
              <Icon name="zap" />
            </button>
          )}
        </>
      )}
      {status === 'starting' && active && (
        <div className="absolute inset-0 flex items-center justify-center gap-3 bg-black/60 text-white/70">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-accent" />
          {t('scan.cameraStarting')}
        </div>
      )}
      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-ink/95 p-5 text-center">
          <Icon name="alert" className="h-10 w-10 text-amber-300" />
          <p className="font-semibold">{status === 'denied' ? t('scan.camDenied') : status === 'unavailable' ? t('scan.camUnavailable') : t('scan.camError')}</p>
          <p className="text-sm text-white/50">{status === 'denied' ? t('scan.camDeniedHelp') : t('scan.camFallback')}</p>
          <button className="btn btn-primary" onClick={() => setAttempt((a) => a + 1)}>
            {t('retry')}
          </button>
        </div>
      )}
      {!active && <div className="absolute inset-0 flex items-center justify-center bg-ink text-white/40">{t('scan.cameraOff')}</div>}
    </div>
  );
}
