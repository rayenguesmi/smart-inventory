import { useApp } from '../context';
import { Shell, Page } from '../components/Shell';
import { Icon } from '../components/ui';
import { go } from '../router';

const ITEMS = [
  { path: '/sessions', icon: 'layers', key: 'sessions' },
  { path: '/locations', icon: 'pin', key: 'nav.locations' },
  { path: '/unknown', icon: 'help', key: 'nav.unknown' },
  { path: '/reports', icon: 'file', key: 'nav.reports' },
  { path: '/import', icon: 'upload', key: 'nav.import' },
  { path: '/backup', icon: 'shield', key: 'nav.backup' },
  { path: '/settings', icon: 'settings', key: 'nav.settings' },
];

export default function More() {
  const { t } = useApp();
  return (
    <Shell title={t('nav.more')}>
      <Page>
        <div className="grid grid-cols-2 gap-3">
          {ITEMS.map((i) => (
            <button key={i.path} onClick={() => go(i.path)} className="card flex min-h-28 flex-col items-center justify-center gap-2 text-center active:bg-panel2">
              <Icon name={i.icon} className="h-8 w-8 text-accent2" />
              <span className="font-medium">{t(i.key)}</span>
            </button>
          ))}
        </div>
      </Page>
    </Shell>
  );
}
