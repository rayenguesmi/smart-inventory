import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useApp } from '../context';
import { Shell, Page } from '../components/Shell';
import { Badge, Btn, Card, Icon, Input, Select, Stat } from '../components/ui';
import { go } from '../router';
import { fmtDateTime, fmtNum } from '../lib/util';
import type { StockOutDocument, StockOutReason, StockOutStatus } from '../types';

export default function StockOutDashboard() {
  const { t, settings } = useApp();
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | StockOutStatus>('all');
  const [reasonFilter, setReasonFilter] = useState<'all' | StockOutReason>('all');

  const allDocs = useLiveQuery(
    async () => (await db.stockOuts.toArray()).sort((a, b) => b.createdAt - a.createdAt),
    []
  );

  const stats = useMemo(() => {
    if (!allDocs) return null;
    const confirmed = allDocs.filter((d) => d.status === 'confirmed');
    const drafts = allDocs.filter((d) => d.status === 'draft');
    const reversed = allDocs.filter((d) => d.status === 'reversed');

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTodayMs = startOfToday.getTime();

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const startOfMonthMs = startOfMonth.getTime();

    let totalQty = 0;
    let totalProducts = 0;
    let todayQty = 0;
    let monthQty = 0;

    const productMap = new Map<string, { name: string; qty: number }>();

    for (const d of confirmed) {
      totalQty += d.totalQuantity;
      totalProducts += d.totalLines;

      const dateMs = d.confirmedAt ?? d.dateTime;
      if (dateMs >= startOfTodayMs) todayQty += d.totalQuantity;
      if (dateMs >= startOfMonthMs) monthQty += d.totalQuantity;

      for (const line of d.lines) {
        const item = productMap.get(line.productId) ?? { name: line.name, qty: 0 };
        item.qty += line.quantity;
        productMap.set(line.productId, item);
      }
    }

    const topProducts = Array.from(productMap.values())
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    return {
      totalDocs: allDocs.length,
      confirmedCount: confirmed.length,
      draftCount: drafts.length,
      reversedCount: reversed.length,
      totalQty,
      totalProducts,
      todayQty,
      monthQty,
      topProducts,
    };
  }, [allDocs]);

  const filteredDocs = useMemo(() => {
    if (!allDocs) return [];
    const query = q.trim().toLowerCase();
    return allDocs.filter((d) => {
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (reasonFilter !== 'all' && d.reason !== reasonFilter) return false;
      if (!query) return true;
      return (
        d.docNo.toLowerCase().includes(query) ||
        d.recipient.toLowerCase().includes(query) ||
        d.warehouse.toLowerCase().includes(query) ||
        (d.deliveryRef ?? '').toLowerCase().includes(query) ||
        d.lines.some(
          (l) =>
            l.name.toLowerCase().includes(query) ||
            (l.reference ?? '').toLowerCase().includes(query) ||
            (l.barcode ?? '').includes(query)
        )
      );
    });
  }, [allDocs, q, statusFilter, reasonFilter]);

  const statusBadge = (s: StockOutStatus) => {
    switch (s) {
      case 'confirmed':
        return <Badge tone="ok">{t('stockOut.status.confirmed')}</Badge>;
      case 'draft':
        return <Badge tone="warn">{t('stockOut.status.draft')}</Badge>;
      case 'reversed':
        return <Badge tone="mute">{t('stockOut.status.reversed')}</Badge>;
    }
  };

  return (
    <Shell
      title={settings.lang === 'ar' ? 'لوحة تحكم خروج المخزون' : 'Stock OUT — Sorties'}
      back="/more"
      right={
        <Btn variant="primary" className="!min-h-11 !px-3" onClick={() => go('/stock-out/new')}>
          <Icon name="plus" className="h-5 w-5" />
          <span className="hidden min-[380px]:inline ms-1">{settings.lang === 'ar' ? 'إذن جديد' : 'Nouveau'}</span>
        </Btn>
      }
    >
      <Page>
        {/* Quick Action Banner */}
        <div className="flex gap-2">
          <Btn variant="primary" className="flex-1 !min-h-14 text-base font-bold" onClick={() => go('/stock-out/new')}>
            <Icon name="plus" className="h-6 w-6" />
            {settings.lang === 'ar' ? 'إنشاء إذن خروج جديد (Stock OUT)' : 'Nouveau Bon de Sortie'}
          </Btn>
          <Btn className="!min-h-14 !px-4" onClick={() => go('/stock-out/history')}>
            <Icon name="clock" className="h-5 w-5" />
            <span className="hidden sm:inline ms-1">{settings.lang === 'ar' ? 'السجل' : 'Historique'}</span>
          </Btn>
        </div>

        {/* Metrics Grid */}
        {stats && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <Stat
                label={settings.lang === 'ar' ? 'إجمالي الأذونات' : 'Total Bons'}
                value={stats.totalDocs}
                sub={`${stats.confirmedCount} ${settings.lang === 'ar' ? 'مؤكد' : 'confirmés'}`}
              />
              <Stat
                label={settings.lang === 'ar' ? 'الكميات الخارجة' : 'Unités sorties'}
                value={fmtNum(stats.totalQty)}
                sub={`${stats.totalProducts} ${settings.lang === 'ar' ? 'منتج مختلف' : 'articles'}`}
                tone="ok"
              />
              <Stat
                label={settings.lang === 'ar' ? 'المسودات المعلقة' : 'Brouillons'}
                value={stats.draftCount}
                sub={settings.lang === 'ar' ? 'لم تخصم بعد' : 'En attente'}
                tone={stats.draftCount > 0 ? 'warn' : undefined}
              />
              <Stat
                label={settings.lang === 'ar' ? 'خروج اليوم' : 'Sorties aujourd’hui'}
                value={fmtNum(stats.todayQty)}
                sub={`${fmtNum(stats.monthQty)} ${settings.lang === 'ar' ? 'هذا الشهر' : 'ce mois'}`}
              />
            </div>

            {/* Top Products Issued */}
            {stats.topProducts.length > 0 && (
              <Card className="space-y-2">
                <p className="font-semibold text-xs text-white/60">
                  {settings.lang === 'ar' ? 'المنتجات الأكثر خروجًا' : 'Articles les plus sortis'}
                </p>
                <div className="flex flex-wrap gap-2">
                  {stats.topProducts.map((p, idx) => (
                    <span key={idx} className="chip text-xs">
                      <b className="me-1 text-accent2">#{idx + 1}</b> {p.name}:{' '}
                      <b className="ms-1 text-white">{fmtNum(p.qty)}</b>
                    </span>
                  ))}
                </div>
              </Card>
            )}
          </div>
        )}

        {/* Filter Bar */}
        <div className="space-y-2">
          <div className="relative">
            <Icon
              name="search"
              className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-white/30"
            />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={
                settings.lang === 'ar'
                  ? 'بحث برقم الإذن (OUT-...)، المستلم، المنتج…'
                  : 'Recherche réf (OUT-...), destinataire, produit…'
              }
              className="!ps-12"
            />
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
              <option value="all">— {settings.lang === 'ar' ? 'كل الحالات' : 'Tous statuts'} —</option>
              <option value="confirmed">{t('stockOut.status.confirmed')}</option>
              <option value="draft">{t('stockOut.status.draft')}</option>
              <option value="reversed">{t('stockOut.status.reversed')}</option>
            </Select>

            <Select value={reasonFilter} onChange={(e) => setReasonFilter(e.target.value as any)}>
              <option value="all">— {settings.lang === 'ar' ? 'كل الأسباب' : 'Tous motifs'} —</option>
              <option value="customer_delivery">{t('stockOut.reason.customer_delivery')}</option>
              <option value="internal_consumption">{t('stockOut.reason.internal_consumption')}</option>
              <option value="transfer_warehouse">{t('stockOut.reason.transfer_warehouse')}</option>
              <option value="damaged_products">{t('stockOut.reason.damaged_products')}</option>
              <option value="return_supplier">{t('stockOut.reason.return_supplier')}</option>
              <option value="other">{t('stockOut.reason.other')}</option>
            </Select>
          </div>
        </div>

        {/* Operations List */}
        <div>
          <div className="mb-2 flex items-center justify-between text-xs text-white/50">
            <span>
              {filteredDocs.length} {settings.lang === 'ar' ? 'عملية خروج مسجلة' : 'documents trouvés'}
            </span>
            <button className="text-accent2" onClick={() => go('/stock-out/history')}>
              {settings.lang === 'ar' ? 'عرض السجل الكامل ←' : 'Tout afficher →'}
            </button>
          </div>

          {!allDocs ? (
            <p className="text-sm text-white/50 py-4 text-center">{t('loading')}</p>
          ) : filteredDocs.length === 0 ? (
            <Card className="text-center py-8 text-white/50 space-y-3">
              <Icon name="box" className="mx-auto h-8 w-8 text-white/20" />
              <p>{settings.lang === 'ar' ? 'لا توجد أذونات خروج مطابقة.' : 'Aucun bon de sortie trouvé.'}</p>
              <Btn variant="primary" onClick={() => go('/stock-out/new')}>
                <Icon name="plus" /> {t('stockOut.new')}
              </Btn>
            </Card>
          ) : (
            <div className="space-y-2.5">
              {filteredDocs.slice(0, 20).map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => go('/stock-out/' + doc.id)}
                  className="card w-full flex items-center justify-between gap-3 !p-3 text-start transition active:bg-panel2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono font-bold text-accent2 text-sm">{doc.docNo}</span>
                      {statusBadge(doc.status)}
                    </div>
                    <p className="font-semibold text-sm truncate">{doc.recipient || '—'}</p>
                    <p className="text-xs text-white/40 truncate">
                      {t('stockOut.reason.' + doc.reason)} · {doc.warehouse} · {doc.date}
                    </p>
                  </div>
                  <div className="text-end shrink-0">
                    <span className="block font-bold text-base text-white">
                      {fmtNum(doc.totalQuantity)}{' '}
                      <span className="text-xs font-normal text-white/50">
                        {settings.lang === 'ar' ? 'وحدة' : 'unités'}
                      </span>
                    </span>
                    <span className="text-[11px] text-white/40">
                      {doc.lines.length} {settings.lang === 'ar' ? 'منتج' : 'lignes'}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </Page>
    </Shell>
  );
}

