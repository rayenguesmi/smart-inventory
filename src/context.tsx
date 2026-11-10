import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta, setMeta } from './db';
import { translate } from './i18n';
import type { Loc, Session, Settings } from './types';

export const DEFAULT_SETTINGS: Settings = { lang: 'ar', continuous: true, cooldownMs: 2500, beep: true, vibrate: true };

interface Toast {
  id: number;
  msg: string;
  kind: 'ok' | 'err' | 'info';
  action?: { label: string; fn: () => void };
}

interface ConfirmOpts {
  title?: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

interface Ctx {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  unitLabel: (u: string) => string;
  sessionId: string | null;
  locationId: string | null;
  session?: Session;
  location?: Loc;
  selectSession: (id: string | null) => Promise<void>;
  selectLocation: (id: string | null) => void;
  toast: (msg: string, kind?: Toast['kind'], action?: Toast['action']) => void;
  confirm: (o: ConfirmOpts) => Promise<boolean>;
  online: boolean;
  installPrompt: (() => Promise<void>) | null;
}

const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [installEvt, setInstallEvt] = useState<any>(null);
  const toastId = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const s = await getMeta<Settings>('settings', DEFAULT_SETTINGS);
        const ui = await getMeta<{ sessionId: string | null; locationId: string | null }>('ui', { sessionId: null, locationId: null });
        let sid = ui.sessionId;
        let lid = ui.locationId;
        if (sid && !(await db.sessions.get(sid))) {
          sid = null;
          lid = null;
        }
        if (lid && !(await db.locations.get(lid))) lid = null;
        setSettingsState({ ...DEFAULT_SETTINGS, ...s });
        setSessionId(sid);
        setLocationId(lid);
        setReady(true);
        // Ask the browser not to evict our IndexedDB data under storage pressure.
        navigator.storage?.persist?.().catch(() => undefined);
      } catch (e: any) {
        setFatal(String(e?.message ?? e));
      }
    })();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    const bip = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e);
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener('beforeinstallprompt', bip);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener('beforeinstallprompt', bip);
    };
  }, []);

  useEffect(() => {
    document.documentElement.lang = settings.lang;
    document.documentElement.dir = settings.lang === 'ar' ? 'rtl' : 'ltr';
  }, [settings.lang]);

  const session = useLiveQuery(() => (sessionId ? db.sessions.get(sessionId) : undefined), [sessionId]);
  const location = useLiveQuery(() => (locationId ? db.locations.get(locationId) : undefined), [locationId]);

  const persistUi = (sid: string | null, lid: string | null) => {
    setMeta('ui', { sessionId: sid, locationId: lid }).catch(() => undefined);
    if (sid && lid) setMeta('lastLoc:' + sid, lid).catch(() => undefined);
  };

  const setSettings = useCallback((patch: Partial<Settings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      setMeta('settings', next).catch(() => undefined);
      return next;
    });
  }, []);

  const selectSession = useCallback(async (id: string | null) => {
    let lid: string | null = null;
    if (id) {
      const last = await getMeta<string | null>('lastLoc:' + id, null);
      if (last && (await db.locations.get(last))) lid = last;
    }
    setSessionId(id);
    setLocationId(lid);
    persistUi(id, lid);
  }, []);

  const selectLocation = useCallback(
    (id: string | null) => {
      setLocationId(id);
      persistUi(sessionId, id);
    },
    [sessionId]
  );

  const t = useCallback((key: string, vars?: Record<string, string | number>) => translate(settings.lang, key, vars), [settings.lang]);
  const unitLabel = useCallback((u: string) => translate(settings.lang, 'unit.' + u), [settings.lang]);

  const toast = useCallback((msg: string, kind: Toast['kind'] = 'ok', action?: Toast['action']) => {
    const id = ++toastId.current;
    setToasts((l) => [...l.slice(-2), { id, msg, kind, action }]);
    setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), action ? 6000 : 2800);
  }, []);

  const confirm = useCallback(
    (o: ConfirmOpts) => new Promise<boolean>((resolve) => setDialog({ ...o, resolve })),
    []
  );

  const installPrompt = installEvt
    ? async () => {
        await installEvt.prompt();
        setInstallEvt(null);
      }
    : null;

  if (fatal) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-xl font-semibold">Base de données indisponible / قاعدة البيانات غير متاحة</p>
        <p className="text-sm text-white/60">
          IndexedDB is required (private/incognito mode can block it). / يتطلب التطبيق IndexedDB (الوضع الخاص قد يمنعه).
        </p>
        <code className="text-xs text-red-300">{fatal}</code>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-line border-t-accent" />
      </div>
    );
  }

  const value: Ctx = { settings, setSettings, t, unitLabel, sessionId, locationId, session, location, selectSession, selectLocation, toast, confirm, online, installPrompt };

  return (
    <AppCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex flex-col items-center gap-2 px-3">
        {toasts.map((x) => (
          <div
            key={x.id}
            className={`pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl border px-4 py-3 text-base shadow-xl animate-[fadein_.15s_ease-out] ${
              x.kind === 'ok' ? 'border-emerald-500/50 bg-emerald-950/95' : x.kind === 'err' ? 'border-red-500/50 bg-red-950/95' : 'border-accent/50 bg-panel2/95'
            }`}
            role="status"
          >
            <span className="flex-1">{x.msg}</span>
            {x.action && (
              <button
                className="rounded-lg bg-white/10 px-3 py-2 font-semibold"
                onClick={() => {
                  x.action!.fn();
                  setToasts((l) => l.filter((y) => y.id !== x.id));
                }}
              >
                {x.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
      {dialog && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 p-3 sm:items-center">
          <div className="w-full max-w-md rounded-3xl border border-line bg-panel p-5 shadow-2xl">
            {dialog.title && <h2 className="mb-2 text-lg font-semibold">{dialog.title}</h2>}
            <p className="whitespace-pre-line text-base text-white/80">{dialog.message}</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                className="btn btn-ghost"
                onClick={() => {
                  dialog.resolve(false);
                  setDialog(null);
                }}
              >
                {t('cancel')}
              </button>
              <button
                className={`btn ${dialog.danger ? 'btn-danger' : 'btn-primary'}`}
                onClick={() => {
                  dialog.resolve(true);
                  setDialog(null);
                }}
              >
                {dialog.confirmLabel ?? t('confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppCtx.Provider>
  );
}
