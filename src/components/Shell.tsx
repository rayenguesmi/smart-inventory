import type { ReactNode } from 'react';
import { useApp } from '../context';
import { go, goBack, useRoute } from '../router';
import { Icon } from './ui';

const TABS = [
  { path: '/', icon: 'home', key: 'nav.home' },
  { path: '/scan', icon: 'scan', key: 'nav.scan' },
  { path: '/products', icon: 'box', key: 'nav.products' },
  { path: '/history', icon: 'clock', key: 'nav.history' },
  { path: '/more', icon: 'grid', key: 'nav.more' },
];

export function Shell({ title, back, right, children, noNav }: { title: string; back?: boolean | string; right?: ReactNode; children: ReactNode; noNav?: boolean }) {
  const { t, online } = useApp();
  const { path } = useRoute();
  const moreRoutes = ['/more', '/sessions', '/session', '/locations', '/unknown', '/reports', '/import', '/backup', '/settings'];
  const activeTab = (p: string) => (p === '/' ? path === '/' : p === '/more' ? moreRoutes.some((r) => path.startsWith(r)) : path.startsWith(p));
  return (
    <div className="flex h-full flex-col">
      <header className="safe-top flex items-center gap-2 border-b border-line bg-panel px-3 pb-2">
        {back && (
          <button
            onClick={() => (back === true ? goBack() : go(back))}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white/80 active:bg-line"
            aria-label={t('back')}
          >
            <Icon name="chevron" className="h-7 w-7 rtl:rotate-180" />
          </button>
        )}
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{title}</h1>
        {right}
        <span
          title={online ? t('online') : t('offline')}
          className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs ${online ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}
        >
          <Icon name={online ? 'wifi' : 'wifioff'} className="h-4 w-4" />
          {online ? t('online') : t('offline')}
        </span>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      {!noNav && (
        <nav className="safe-bottom grid grid-cols-5 border-t border-line bg-panel">
          {TABS.map((tab) => {
            const on = activeTab(tab.path);
            return (
              <button
                key={tab.path}
                onClick={() => go(tab.path)}
                className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs transition ${on ? 'text-accent2' : 'text-white/50'} active:bg-panel2`}
              >
                <Icon name={tab.icon} className={`h-6 w-6 ${tab.path === '/scan' && on ? 'drop-shadow-[0_0_6px_#2f7bff]' : ''}`} />
                {t(tab.key)}
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}

export function Page({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-xl space-y-4 p-4 ${className}`}>{children}</div>;
}
