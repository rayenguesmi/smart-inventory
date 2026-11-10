import { useState } from 'react';
import { useApp } from '../context';
import { Shell, Page } from '../components/Shell';
import { Badge, Btn, Card, Icon, Select } from '../components/ui';
import { loadDemo, removeDemo } from '../lib/demo';
import { runSelfTest, type TestStep } from '../lib/selftest';

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!value)} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl border border-line bg-panel2 px-4 text-start">
      <span>{label}</span>
      <span className={`flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition ${value ? 'bg-accent' : 'bg-line'}`}>
        <span className={`h-6 w-6 rounded-full bg-white transition-all ${value ? 'ms-6' : 'ms-0'}`} />
      </span>
    </button>
  );
}

/** Screen 15: language, scanning behaviour, demo data, self-test. */
export default function Settings() {
  const { t, settings, setSettings, selectSession, selectLocation, toast, confirm, installPrompt, online } = useApp();
  const [tests, setTests] = useState<TestStep[] | null>(null);
  const [running, setRunning] = useState(false);

  const demo = async () => {
    const ids = await loadDemo();
    await selectSession(ids.sessionId);
    selectLocation(ids.locationId);
    toast(t('settings.demoLoaded'));
  };
  const undemo = async () => {
    if (!(await confirm({ message: t('settings.demoRemoveConfirm'), danger: true, confirmLabel: t('delete') }))) return;
    const r = await removeDemo();
    if (!r.ok) return toast(t('settings.demoBlocked', { n: r.blockedBy ?? 0 }), 'err');
    await selectSession(null);
    toast(t('settings.demoRemoved'));
  };
  const test = async () => {
    setRunning(true);
    setTests(await runSelfTest());
    setRunning(false);
  };

  return (
    <Shell title={t('nav.settings')} back="/more">
      <Page>
        <Card className="space-y-3">
          <p className="font-semibold">{t('settings.language')}</p>
          <div className="grid grid-cols-2 gap-2">
            <Btn variant={settings.lang === 'ar' ? 'primary' : 'ghost'} onClick={() => setSettings({ lang: 'ar' })}>
              العربية
            </Btn>
            <Btn variant={settings.lang === 'fr' ? 'primary' : 'ghost'} onClick={() => setSettings({ lang: 'fr' })}>
              Français
            </Btn>
          </div>
        </Card>

        <Card className="space-y-3">
          <p className="font-semibold">{t('settings.scanning')}</p>
          <Toggle label={t('settings.continuous')} value={settings.continuous} onChange={(v) => setSettings({ continuous: v })} />
          <Toggle label={t('settings.beep')} value={settings.beep} onChange={(v) => setSettings({ beep: v })} />
          <Toggle label={t('settings.vibrate')} value={settings.vibrate} onChange={(v) => setSettings({ vibrate: v })} />
          <div>
            <p className="label">{t('settings.cooldown')}</p>
            <Select value={settings.cooldownMs} onChange={(e) => setSettings({ cooldownMs: Number(e.target.value) })}>
              <option value={1500}>1.5 s</option>
              <option value={2500}>2.5 s</option>
              <option value={4000}>4 s</option>
            </Select>
          </div>
        </Card>

        {installPrompt && (
          <Btn variant="primary" className="w-full" onClick={installPrompt}>
            <Icon name="download" /> {t('settings.install')}
          </Btn>
        )}

        <Card className="space-y-3">
          <div className="flex items-center gap-2">
            <p className="font-semibold">{t('settings.demo')}</p>
            <Badge tone="warn">DEMO</Badge>
          </div>
          <p className="text-sm text-white/50">{t('settings.demoHelp')}</p>
          <div className="grid grid-cols-2 gap-2">
            <Btn onClick={demo}>{t('settings.demoLoad')}</Btn>
            <Btn onClick={undemo}>{t('settings.demoRemove')}</Btn>
          </div>
        </Card>

        <Card className="space-y-3">
          <p className="font-semibold">{t('settings.selftest')}</p>
          <p className="text-sm text-white/50">{t('settings.selftestHelp')}</p>
          <Btn className="w-full" disabled={running} onClick={test}>
            {running ? t('loading') : t('settings.selftestRun')}
          </Btn>
          {tests && (
            <ul className="space-y-1 text-sm">
              {tests.map((s, i) => (
                <li key={i} className={s.ok ? 'text-emerald-300' : 'text-red-300'}>
                  {s.ok ? '✓' : '✕'} {s.name}
                  {s.detail ? <span className="text-white/40"> — {s.detail}</span> : null}
                </li>
              ))}
              <li className="pt-1 font-semibold">{tests.every((x) => x.ok) ? t('settings.selftestOk') : t('settings.selftestFail')}</li>
            </ul>
          )}
        </Card>

        <Card className="space-y-1 text-sm text-white/50">
          <p className="font-semibold text-white">SMART INVENTORY v1.0</p>
          <p>{online ? t('online') : t('offline')} · {t('settings.localOnly')}</p>
          <p>{t('settings.privacy')}</p>
        </Card>
      </Page>
    </Shell>
  );
}
