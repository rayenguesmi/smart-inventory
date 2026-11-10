import { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useApp } from '../context';
import { Shell, Page } from '../components/Shell';
import { Badge, Btn, Card, Empty, Icon, Input, Modal, Select, TextArea } from '../components/ui';
import { go } from '../router';
import {
  exportStockOutHistoryToCsv,
  reverseStockOut,
  duplicateStockOutAsDraft,
} from '../lib/stockOut';
import { fmtDateTime, fmtNum } from '../lib/util';
import type { StockOutDocument, StockOutReason, StockOutStatus } from '../types';

export default function StockOutHistory() {
  const { t, settings, toast, confirm } = useApp();

  // Filters state
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | StockOutStatus>('all');
  const [reasonFilter, setReasonFilter] = useState<'all' | StockOutReason>('all');
  const [warehouseFilter, setWarehouseFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Reversal modal state
  const [reversalDoc, setReversalDoc] = useState<StockOutDocument | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [reversing, setReversing] = useState(false);

  // Load all documents
  const allDocs = useLiveQuery(
    async () => (await db.stockOuts.toArray()).sort((a, b) => b.createdAt - a.createdAt),
    []
  );

  // Load warehouses for filter
  const warehouses = useLiveQuery(async () => {
    const docs = await db.stockOuts.toArray();
    const set = new Set<string>();
    for (const d of docs) {
      if (d.warehouse) set.add(d.warehouse);
    }
    return Array.from(set);
  }, []);

  // Filtered documents
  const filteredDocs = useMemo(() => {
    if (!allDocs) return [];
    const query = q.trim().toLowerCase();

    return allDocs.filter((d) => {
      if (statusFilter !== 'all' && d.status !== statusFilter) return false;
      if (reasonFilter !== 'all' && d.reason !== reasonFilter) return false;
      if (warehouseFilter !== 'all' && d.warehouse !== warehouseFilter) return false;
      if (dateFrom && d.date < dateFrom) return false;
      if (dateTo && d.date > dateTo) return false;

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
  }, [allDocs, q, statusFilter, reasonFilter, warehouseFilter, dateFrom, dateTo]);

  // Aggregate stats of filtered docs
  const stats = useMemo(() => {
    let totalQty = 0;
    let totalLines = 0;
    for (const d of filteredDocs) {
      totalQty += d.totalQuantity;
      totalLines += d.totalLines;
    }
    return { count: filteredDocs.length, totalQty, totalLines };
  }, [filteredDocs]);

  const handleExportCsv = () => {
    if (!filteredDocs.length) {
      toast(t('csv.noData'), 'err');
      return;
    }
    try {
      exportStockOutHistoryToCsv(filteredDocs);
      toast(
        settings.lang === 'ar'
          ? `تم تصدير ${filteredDocs.length} مستند بنجاح`
          : `${filteredDocs.length} documents exportés avec succès`
      );
    } catch (e: any) {
      toast(e?.message || t('err.generic'), 'err');
    }
  };

  const handleDuplicate = async (docId: string) => {
    try {
      const draft = await duplicateStockOutAsDraft(docId);
      toast(settings.lang === 'ar' ? `تم نسخ المسودة: ${draft.docNo}` : `Brouillon créé: ${draft.docNo}`);
      go(`/stock-out/edit/${draft.id}`);
    } catch (e: any) {
      toast(e?.message || t('err.generic'), 'err');
    }
  };

  const handleExecuteReverse = async () => {
    if (!reversalDoc) return;
    if (!reversalReason.trim()) {
      toast(
        settings.lang === 'ar' ? 'يرجى كتابة سبب الإلغاء' : "Veuillez renseigner le motif d'annulation",
        'err'
      );
      return;
    }

    setReversing(true);
    try {
      await reverseStockOut(reversalDoc.id, reversalReason.trim(), 'Admin');
      toast(t('stockOut.reversedToast'));
      setReversalDoc(null);
      setReversalReason('');
    } catch (e: any) {
      toast(e?.message || t('err.generic'), 'err');
    } finally {
      setReversing(false);
    }
  };

  const clearFilters = () => {
    setQ('');
    setStatusFilter('all');
    setReasonFilter('all');
    setWarehouseFilter('all');
    setDateFrom('');
    setDateTo('');
  };

  const statusBadge = (s: StockOutStatus) => {
    switch (s) {
      case 'confirmed':
        return <Badge tone="ok">{t('stockOut.status.confirmed')}</Badge>;
      case 'draft':
        return <Badge tone="warn">{t('stockOut.status.draft')}</Badge>;
      case 'reversed':
        return <Badge tone="danger">{t('stockOut.status.reversed')}</Badge>;
    }
  };

  return (
    <Shell
      title={t('stockOut.historyTitle')}
      back="/stock-out"
      right={
        <Btn
          variant="primary"
          onClick={() => go('/stock-out/new')}
          className="!min-h-9 !py-1 text-xs"
        >
          <Icon name="plus" className="h-4 w-4" />
          <span className="hidden sm:inline">{t('stockOut.newStockOut')}</span>
        </Btn>
      }
    >
      <Page>
        {/* FILTER BAR */}
        <Card className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Icon
                name="search"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40 rtl:left-auto rtl:right-3"
              />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('stockOut.searchPlaceholder')}
                className="pl-9 rtl:pl-3 rtl:pr-9"
              />
            </div>
            <Btn onClick={handleExportCsv} className="!min-h-10">
              <Icon name="download" className="h-4 w-4" />
              {t('stockOut.exportHistoryCsv')}
            </Btn>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div>
              <span className="block text-[11px] text-white/50 mb-1">{t('stockOut.status')}</span>
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="!text-xs"
              >
                <option value="all">{t('stockOut.filterStatusAll')}</option>
                <option value="confirmed">{t('stockOut.status.confirmed')}</option>
                <option value="draft">{t('stockOut.status.draft')}</option>
                <option value="reversed">{t('stockOut.status.reversed')}</option>
              </Select>
            </div>

            <div>
              <span className="block text-[11px] text-white/50 mb-1">{t('stockOut.reason')}</span>
              <Select
                value={reasonFilter}
                onChange={(e) => setReasonFilter(e.target.value as any)}
                className="!text-xs"
              >
                <option value="all">{t('stockOut.filterReasonAll')}</option>
                <option value="customer_delivery">{t('stockOut.reasons.customer_delivery')}</option>
                <option value="internal_consumption">
                  {t('stockOut.reasons.internal_consumption')}
                </option>
                <option value="warehouse_transfer">
                  {t('stockOut.reasons.warehouse_transfer')}
                </option>
                <option value="damaged">{t('stockOut.reasons.damaged')}</option>
                <option value="supplier_return">{t('stockOut.reasons.supplier_return')}</option>
                <option value="other">{t('stockOut.reasons.other')}</option>
              </Select>
            </div>

            <div>
              <span className="block text-[11px] text-white/50 mb-1">{t('stockOut.warehouse')}</span>
              <Select
                value={warehouseFilter}
                onChange={(e) => setWarehouseFilter(e.target.value)}
                className="!text-xs"
              >
                <option value="all">{settings.lang === 'ar' ? 'جميع المستودعات' : 'Tous entrepôts'}</option>
                {(warehouses ?? []).map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <span className="block text-[11px] text-white/50 mb-1">
                {settings.lang === 'ar' ? 'مسح الفلاتر' : 'Réinitialiser'}
              </span>
              <Btn onClick={clearFilters} className="w-full !min-h-10 !text-xs">
                <Icon name="x" className="h-4 w-4" />
                {settings.lang === 'ar' ? 'إعادة ضبط' : 'Effacer'}
              </Btn>
            </div>
          </div>

          {/* DATE RANGE FILTER */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-line">
            <div>
              <span className="block text-[11px] text-white/50 mb-1">
                {settings.lang === 'ar' ? 'من تاريخ' : 'Du'}
              </span>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="!text-xs"
              />
            </div>
            <div>
              <span className="block text-[11px] text-white/50 mb-1">
                {settings.lang === 'ar' ? 'إلى تاريخ' : 'Au'}
              </span>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="!text-xs"
              />
            </div>
          </div>

          {/* FILTER SUMMARY BADGE */}
          <div className="flex items-center justify-between text-xs text-white/60 pt-1">
            <span>
              {settings.lang === 'ar'
                ? `النتائج: ${stats.count} مستند · ${fmtNum(stats.totalQty)} قطعة / وحدة`
                : `Résultats : ${stats.count} documents · ${fmtNum(stats.totalQty)} unités`}
            </span>
          </div>
        </Card>

        {/* DOCUMENTS LIST */}
        {allDocs === undefined ? (
          <p className="text-center text-white/40 py-8">{t('loading')}</p>
        ) : filteredDocs.length === 0 ? (
          <Card className="text-center py-12">
            <Empty
              icon="box"
              title={t('stockOut.noDocs')}
              text={
                q || statusFilter !== 'all' || reasonFilter !== 'all' || warehouseFilter !== 'all'
                  ? settings.lang === 'ar'
                    ? 'لم يتم العثور على مستندات تطابق الفلاتر المحددة'
                    : 'Aucun document ne correspond à vos filtres'
                  : undefined
              }
              action={
                <Btn variant="primary" onClick={() => go('/stock-out/new')}>
                  <Icon name="plus" />
                  {t('stockOut.newStockOut')}
                </Btn>
              }
            />
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredDocs.map((doc) => (
              <Card
                key={doc.id}
                className="space-y-3 hover:border-accent2/50 transition cursor-pointer"
                onClick={() => go(`/stock-out/${doc.id}`)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-base text-accent2">
                        {doc.docNo}
                      </span>
                      {statusBadge(doc.status)}
                    </div>
                    <p className="text-xs text-white/40 mt-0.5">
                      {fmtDateTime(doc.dateTime, settings.lang)} · {doc.warehouse}
                    </p>
                  </div>
                  <div className="text-end">
                    <span className="font-mono text-lg font-bold text-white">
                      {fmtNum(doc.totalQuantity)}
                    </span>
                    <span className="block text-[11px] text-white/50">
                      {doc.totalLines} {settings.lang === 'ar' ? 'مواد' : 'lignes'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 rounded-xl bg-panel2/60 p-2.5 text-xs">
                  <div>
                    <span className="block text-white/40">{t('stockOut.recipient')}</span>
                    <span className="font-medium truncate block">{doc.recipient}</span>
                  </div>
                  <div>
                    <span className="block text-white/40">{t('stockOut.reason')}</span>
                    <span className="font-medium truncate block">
                      {t(`stockOut.reasons.${doc.reason}`)}
                      {doc.customReason ? ` (${doc.customReason})` : ''}
                    </span>
                  </div>
                </div>

                {doc.deliveryRef && (
                  <p className="text-xs text-white/60">
                    <span className="text-white/40">{t('stockOut.deliveryRef')}:</span>{' '}
                    <span className="font-mono">{doc.deliveryRef}</span>
                  </p>
                )}

                {/* ACTION BUTTONS */}
                <div
                  className="flex items-center justify-end gap-2 pt-2 border-t border-line"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Btn
                    onClick={() => go(`/stock-out/${doc.id}`)}
                    className="!min-h-8 !py-1 text-xs"
                  >
                    <Icon name="search" className="h-3.5 w-3.5" />
                    {settings.lang === 'ar' ? 'عرض' : 'Voir'}
                  </Btn>

                  {doc.status === 'draft' && (
                    <Btn
                      variant="primary"
                      onClick={() => go(`/stock-out/edit/${doc.id}`)}
                      className="!min-h-8 !py-1 text-xs"
                    >
                      <Icon name="edit" className="h-3.5 w-3.5" />
                      {t('edit')}
                    </Btn>
                  )}

                  {doc.status === 'confirmed' && (
                    <>
                      <Btn
                        onClick={() => handleDuplicate(doc.id)}
                        className="!min-h-8 !py-1 text-xs"
                      >
                        <Icon name="copy" className="h-3.5 w-3.5" />
                        {settings.lang === 'ar' ? 'نسخ' : 'Dupliquer'}
                      </Btn>
                      <Btn
                        variant="danger"
                        onClick={() => {
                          setReversalDoc(doc);
                          setReversalReason('');
                        }}
                        className="!min-h-8 !py-1 text-xs"
                      >
                        <Icon name="undo" className="h-3.5 w-3.5" />
                        {settings.lang === 'ar' ? 'إلغاء' : 'Annuler'}
                      </Btn>
                    </>
                  )}

                  {doc.status === 'reversed' && (
                    <Btn
                      onClick={() => handleDuplicate(doc.id)}
                      className="!min-h-8 !py-1 text-xs"
                    >
                      <Icon name="copy" className="h-3.5 w-3.5" />
                      {settings.lang === 'ar' ? 'نسخ كمسودة' : 'Dupliquer'}
                    </Btn>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </Page>

      {/* REVERSAL MODAL */}
      <Modal
        open={!!reversalDoc}
        onClose={() => setReversalDoc(null)}
        title={t('stockOut.reverseDoc')}
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
            {t('stockOut.reverseDocWarning')}
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1 text-white/70">
              {t('stockOut.reversalReasonRequired')} *
            </label>
            <TextArea
              rows={3}
              value={reversalReason}
              onChange={(e) => setReversalReason(e.target.value)}
              placeholder={
                settings.lang === 'ar'
                  ? 'اكتب سبب الإلغاء (خطأ في الإدخال، إرجاع البضاعة، إلغاء الطلب...)'
                  : 'Précisez la raison (ex: erreur de saisie, commande annulée, retour marchandise...)'
              }
            />
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-line">
            <Btn onClick={() => setReversalDoc(null)}>{t('cancel')}</Btn>
            <Btn
              variant="danger"
              disabled={reversing || !reversalReason.trim()}
              onClick={handleExecuteReverse}
            >
              <Icon name="undo" className="h-4 w-4" />
              {reversing ? t('loading') : t('stockOut.confirmReversal')}
            </Btn>
          </div>
        </div>
      </Modal>
    </Shell>
  );
}

