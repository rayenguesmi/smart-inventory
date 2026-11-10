import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useApp } from '../context';
import { Shell, Page } from '../components/Shell';
import { Btn, Card, Empty, Icon, Select, Spinner } from '../components/ui';
import { exportPhotoPackage, exportReport, productRows, type ReportKind } from '../lib/reports';
import { downloadCsv, downloadXlsx } from '../lib/io';
import { stamp } from '../lib/util';
import { go } from '../router';

const REPORTS: { kind: ReportKind; icon: string }[] = [
  { kind: 'full', icon: 'file' },
  { kind: 'inventory', icon: 'box' },
  { kind: 'locations', icon: 'pin' },
  { kind: 'unknown', icon: 'help' },
];

/** Screen 12: exports. */
export default function Reports() {
  const { t, unitLabel, settings, sessionId, selectSession, toast } = useApp();
  const sessions = useLiveQuery(() => db.sessions.orderBy('createdAt').reverse().toArray(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState('');

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
      toast(t('reports.done'));
    } catch (e) {
      console.error(e);
      toast(t('err.export'), 'err');
    } finally {
      setBusy(null);
      setProgress('');
    }
  };

  const ctx = () => ({ sessionId: sessionId!, lang: settings.lang, unitLabel });

  return (
    <Shell title={t('nav.reports')} back="/more">
      <Page>
        <Select value={sessionId ?? ''} onChange={(e) => selectSession(e.target.value || null)}>
          <option value="">{t('history.pickSession')}</option>
          {(sessions ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} — {s.date}
            </option>
          ))}
        </Select>

        {!sessionId ? (
          <Empty icon="file" title={t('home.noSession')} action={<Btn variant="primary" onClick={() => go('/sessions')}>{t('sessions')}</Btn>} />
        ) : (
          REPORTS.map(({ kind, icon }) => (
            <Card key={kind} className="space-y-3">
              <div className="flex items-start gap-3">
                <Icon name={icon} className="mt-1 h-6 w-6 shrink-0 text-accent2" />
                <div>
                  <p className="font-semibold">{t('reports.' + kind)}</p>
                  <p className="text-sm text-white/50">{t('reports.' + kind + 'Help')}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Btn variant="primary" disabled={!!busy} onClick={() => run(kind + 'x', () => exportReport(kind, 'xlsx', ctx()))}>
                  <Icon name="download" className="h-5 w-5" /> Excel (.xlsx)
                </Btn>
                <Btn disabled={!!busy} onClick={() => run(kind + 'c', () => exportReport(kind, 'csv', ctx()))}>
                  <Icon name="download" className="h-5 w-5" /> CSV
                </Btn>
              </div>
              {(busy === kind + 'x' || busy === kind + 'c') && <Spinner label={t('loading')} />}
            </Card>
          ))
        )}

        <Card className="space-y-3 border-accent2/30 bg-accent2/5">
          <div className="flex items-start gap-3">
            <Icon name="database" className="mt-1 h-6 w-6 shrink-0 text-accent2" />
            <div>
              <p className="font-semibold">{settings.lang === 'ar' ? 'إدارة ملفات CSV المتقدمة' : 'Gestion avancée CSV & Excel'}</p>
              <p className="text-sm text-white/50">{settings.lang === 'ar' ? 'تصدير شامل بـ 19 حقل، تفاصيل مواقع المخزون، واستيراد وتحديث آمن' : 'Export complet 19 colonnes, détail par emplacement, import & mise à jour'}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Btn variant="primary" onClick={() => go('/csv')}>
              <Icon name="database" className="h-4 w-4" /> CSV Management
            </Btn>
            <Btn onClick={() => go('/labels')}>
              <Icon name="barcode" className="h-4 w-4" /> {settings.lang === 'ar' ? 'ملصقات الباركود' : 'Étiquettes'}
            </Btn>
          </div>
        </Card>

        <Card className="space-y-3">
          <div className="flex items-start gap-3">
            <Icon name="box" className="mt-1 h-6 w-6 shrink-0 text-accent2" />
            <div>
              <p className="font-semibold">{t('reports.products')}</p>
              <p className="text-sm text-white/50">{t('reports.productsHelp')}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Btn disabled={!!busy} onClick={() => run('px', async () => downloadXlsx(`produits-${stamp()}`, [{ name: 'Produits', rows: await productRows() }]))}>
              <Icon name="download" className="h-5 w-5" /> Excel
            </Btn>
            <Btn disabled={!!busy} onClick={() => run('pc', async () => downloadCsv(`produits-${stamp()}`, await productRows()))}>
              <Icon name="download" className="h-5 w-5" /> CSV
            </Btn>
          </div>
        </Card>

        <Card className="space-y-3">
          <div className="flex items-start gap-3">
            <Icon name="image" className="mt-1 h-6 w-6 shrink-0 text-accent2" />
            <div>
              <p className="font-semibold">{t('reports.photos')}</p>
              <p className="text-sm text-white/50">{t('reports.photosHelp')}</p>
            </div>
          </div>
          <Btn
            className="w-full"
            disabled={!!busy}
            onClick={() => run('zip', () => exportPhotoPackage((d, n) => setProgress(`${d}/${n}`)))}
          >
            <Icon name="download" className="h-5 w-5" /> ZIP
          </Btn>
          {busy === 'zip' && <Spinner label={progress || t('loading')} />}
        </Card>
      </Page>
    </Shell>
  );
}
