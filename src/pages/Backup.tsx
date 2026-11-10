import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getMeta } from '../db';
import { useApp } from '../context';
import { Shell, Page } from '../components/Shell';
import { Btn, Card, Icon, Spinner } from '../components/ui';
import { downloadBackup, restoreBackup, validateBackup, wipeAll, type Validation } from '../lib/backup';
import { fmtDateTime } from '../lib/util';

/** Screen 14: JSON backup, validated restore, storage info, and the data-location warning. */
export default function Backup() {
  const { t, settings, toast, confirm } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [withPhotos, setWithPhotos] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [check, setCheck] = useState<{ name: string; v: Validation } | null>(null);
  const [storage, setStorage] = useState<{ used?: number; quota?: number; persisted?: boolean }>({});
  const last = useLiveQuery(() => getMeta<number | null>('lastBackup', null), []);

  useEffect(() => {
    (async () => {
      try {
        const est = await navigator.storage?.estimate?.();
        const persisted = await navigator.storage?.persisted?.();
        setStorage({ used: est?.usage, quota: est?.quota, persisted });
      } catch {
        /* not available */
      }
    })();
  }, []);

  const mb = (n?: number) => (n === undefined ? '—' : (n / 1048576).toFixed(1) + ' MB');

  const doBackup = async () => {
    setBusy('backup');
    try {
      const size = await downloadBackup(withPhotos);
      toast(`${t('backup.saved')} (${mb(size)})`);
    } catch (e) {
      console.error(e);
      toast(t('err.export'), 'err');
    } finally {
      setBusy(null);
    }
  };

  const pick = async (f: File) => {
    setBusy('validate');
    try {
      setCheck({ name: f.name, v: validateBackup(await f.text()) });
    } catch {
      setCheck({ name: f.name, v: { ok: false, errors: ['JSON_INVALID'], warnings: [] } });
    } finally {
      setBusy(null);
    }
  };

  const doRestore = async () => {
    if (!check?.v.ok || !check.v.data) return;
    const ok = await confirm({
      title: t('backup.restoreTitle'),
      message: t('backup.restoreConfirm', { records: check.v.summary!.records, products: check.v.summary!.products }),
      confirmLabel: t('backup.replace'),
      danger: true,
    });
    if (!ok) return;
    setBusy('restore');
    try {
      await restoreBackup(check.v.data);
      toast(t('backup.restored'));
      setTimeout(() => window.location.reload(), 600); // reload so every screen reads the restored data
    } catch (e) {
      console.error(e);
      toast(t('backup.restoreFailed'), 'err');
      setBusy(null);
    }
  };

  const doWipe = async () => {
    if (!(await confirm({ title: t('backup.wipe'), message: t('backup.wipeConfirm'), danger: true, confirmLabel: t('backup.wipe') }))) return;
    if (!(await confirm({ message: t('backup.wipeConfirm2'), danger: true, confirmLabel: t('backup.wipeYes') }))) return;
    await wipeAll();
    window.location.reload();
  };

  return (
    <Shell title={t('nav.backup')} back="/more">
      <Page>
        <Card className="space-y-2 border-amber-500/40 bg-amber-500/5">
          <p className="flex items-center gap-2 font-semibold text-amber-200">
            <Icon name="alert" className="h-5 w-5" /> {t('backup.limitTitle')}
          </p>
          <p className="text-sm text-white/70">{t('backup.limit')}</p>
        </Card>

        <Card className="space-y-3">
          <p className="font-semibold">{t('backup.export')}</p>
          <p className="text-sm text-white/50">
            {t('backup.last')}: {last ? fmtDateTime(last, settings.lang) : t('backup.never')}
          </p>
          <label className="flex min-h-12 items-center gap-3 rounded-2xl border border-line bg-panel2 px-4 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-[#2f7bff]" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} />
            {t('backup.withPhotos')}
          </label>
          <Btn variant="primary" className="w-full !min-h-16" disabled={!!busy} onClick={doBackup}>
            <Icon name="download" /> {t('backup.download')}
          </Btn>
          {busy === 'backup' && <Spinner label={t('loading')} />}
        </Card>

        <Card className="space-y-3">
          <p className="font-semibold">{t('backup.restore')}</p>
          <p className="text-sm text-white/50">{t('backup.restoreHelp')}</p>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
          <Btn className="w-full" disabled={!!busy} onClick={() => fileRef.current?.click()}>
            <Icon name="upload" /> {t('backup.choose')}
          </Btn>
          {busy === 'validate' && <Spinner label={t('backup.validating')} />}
          {check && (
            <div className={`space-y-2 rounded-2xl border p-3 text-sm ${check.v.ok ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5'}`}>
              <p className="break-all font-semibold">{check.name}</p>
              {check.v.ok && check.v.summary ? (
                <>
                  <p className="text-emerald-300">✓ {t('backup.valid')}</p>
                  <ul className="grid grid-cols-2 gap-x-3 text-white/70">
                    <li>{t('nav.products')}: {check.v.summary.products}</li>
                    <li>{t('sessions')}: {check.v.summary.sessions}</li>
                    <li>{t('nav.locations')}: {check.v.summary.locations}</li>
                    <li>{t('stat.records')}: {check.v.summary.records}</li>
                    <li>{t('form.photos')}: {check.v.summary.photos}</li>
                    <li>{fmtDateTime(check.v.summary.exportedAt, settings.lang)}</li>
                  </ul>
                  {check.v.warnings.map((w) => (
                    <p key={w} className="text-amber-300">⚠ {t('backup.warn.' + w.split(':')[0], { n: w.split(':')[1] ?? '' })}</p>
                  ))}
                  <Btn variant="danger" className="w-full" disabled={!!busy} onClick={doRestore}>
                    {t('backup.replace')}
                  </Btn>
                </>
              ) : (
                <>
                  <p className="text-red-300">✕ {t('backup.invalid')}</p>
                  <ul className="list-disc ps-5 text-white/70">
                    {check.v.errors.map((e) => (
                      <li key={e}>{t('backup.err.' + e.split(':')[0], { x: e.split(':')[1] ?? '' })}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
          {busy === 'restore' && <Spinner label={t('loading')} />}
        </Card>

        <Card className="space-y-1 text-sm text-white/60">
          <p className="font-semibold text-white">{t('backup.storage')}</p>
          <p>
            {mb(storage.used)} / {mb(storage.quota)}
          </p>
          <p>{storage.persisted ? '✓ ' + t('backup.persisted') : '⚠ ' + t('backup.notPersisted')}</p>
        </Card>

        <Card className="space-y-2">
          <p className="font-semibold text-red-300">{t('backup.danger')}</p>
          <Btn variant="danger" className="w-full" onClick={doWipe}>
            <Icon name="trash" /> {t('backup.wipe')}
          </Btn>
        </Card>
      </Page>
    </Shell>
  );
}
