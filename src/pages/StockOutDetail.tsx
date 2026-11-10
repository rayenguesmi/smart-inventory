import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useApp } from '../context';
import { Shell, Page } from '../components/Shell';
import { Badge, Btn, Card, Empty, Icon, Input, Modal, TextArea } from '../components/ui';
import { BarcodeView } from '../components/BarcodeView';
import { go, goBack } from '../router';
import {
  confirmStockOut,
  reverseStockOut,
  duplicateStockOutAsDraft,
  exportStockOutDocumentToCsv,
  StockOutError,
} from '../lib/stockOut';
import { fmtDateTime, fmtNum } from '../lib/util';
import type { StockOutDocument, StockOutStatus } from '../types';

export default function StockOutDetail({ id }: { id: string }) {
  const { t, settings, toast, confirm } = useApp();
  const [reversing, setReversing] = useState(false);
  const [reversalReason, setReversalReason] = useState('');
  const [showReverseModal, setShowReverseModal] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const doc = useLiveQuery(() => db.stockOuts.get(id), [id]);

  if (doc === undefined) {
    return (
      <Shell title="..." back="/stock-out">
        <Page>
          <p className="text-white/50">{t('loading')}</p>
        </Page>
      </Shell>
    );
  }

  if (doc === null) {
    return (
      <Shell title={t('stockOut.title')} back="/stock-out">
        <Empty icon="alert" title={t('err.NOT_FOUND')} />
      </Shell>
    );
  }

  const handlePrint = () => {
    window.print();
  };

  const handleExportCsv = () => {
    try {
      exportStockOutDocumentToCsv(doc);
      toast(settings.lang === 'ar' ? 'تم تحميل ملف CSV بنجاح' : 'Fichier CSV téléchargé avec succès');
    } catch (err: any) {
      toast(err?.message || t('err.generic'), 'err');
    }
  };

  const handleConfirm = async () => {
    const ok = await confirm({
      title: t('stockOut.confirmDialogTitle'),
      message: t('stockOut.confirmDialogMsg', { docNo: doc.docNo, count: doc.totalQuantity }),
      confirmLabel: t('stockOut.confirmDocument'),
    });
    if (!ok) return;

    setConfirming(true);
    try {
      await confirmStockOut(doc.id, 'Admin');
      toast(t('stockOut.confirmedToast'));
    } catch (err: any) {
      console.error(err);
      if (err instanceof StockOutError && err.code === 'INSUFFICIENT_STOCK') {
        toast(err.message, 'err');
      } else {
        toast(err?.message || t('err.generic'), 'err');
      }
    } finally {
      setConfirming(false);
    }
  };

  const handleDuplicate = async () => {
    setActionLoading(true);
    try {
      const draft = await duplicateStockOutAsDraft(doc.id);
      toast(settings.lang === 'ar' ? `تم نسخ المسودة: ${draft.docNo}` : `Brouillon dupliqué: ${draft.docNo}`);
      go(`/stock-out/edit/${draft.id}`);
    } catch (err: any) {
      toast(err?.message || t('err.generic'), 'err');
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenReverseModal = () => {
    setReversalReason('');
    setShowReverseModal(true);
  };

  const handleExecuteReverse = async () => {
    if (!reversalReason.trim()) {
      toast(
        settings.lang === 'ar' ? 'يرجى تحديد سبب الإلغاء' : "Veuillez préciser la raison de l'annulation",
        'err'
      );
      return;
    }

    setReversing(true);
    try {
      await reverseStockOut(doc.id, reversalReason.trim(), 'Admin');
      toast(t('stockOut.reversedToast'));
      setShowReverseModal(false);
    } catch (err: any) {
      console.error(err);
      toast(err?.message || t('err.generic'), 'err');
    } finally {
      setReversing(false);
    }
  };

  const handleDeleteDraft = async () => {
    const ok = await confirm({
      title: t('delete'),
      message: settings.lang === 'ar' ? `حذف المسودة ${doc.docNo}؟` : `Supprimer le brouillon ${doc.docNo} ?`,
      confirmLabel: t('delete'),
      danger: true,
    });
    if (!ok) return;

    try {
      await db.stockOuts.delete(doc.id);
      toast(settings.lang === 'ar' ? 'تم حذف المسودة' : 'Brouillon supprimé');
      go('/stock-out', true);
    } catch (err: any) {
      toast(err?.message || t('err.generic'), 'err');
    }
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
      title={`${doc.docNo}`}
      back="/stock-out"
      right={
        <div className="print:hidden flex items-center gap-1">
          <button
            onClick={handlePrint}
            title={t('stockOut.printVoucher')}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-white/80 active:bg-line"
          >
            <Icon name="printer" className="h-5 w-5" />
          </button>
          <button
            onClick={handleExportCsv}
            title={t('stockOut.exportDocCsv')}
            className="flex h-10 w-10 items-center justify-center rounded-xl text-white/80 active:bg-line"
          >
            <Icon name="download" className="h-5 w-5" />
          </button>
        </div>
      }
    >
      <Page>
        {/* ACTION BAR (Hidden in print) */}
        <div className="print:hidden flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold font-mono">{doc.docNo}</span>
            {statusBadge(doc.status)}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Btn onClick={handlePrint} className="!min-h-9 !py-1 text-xs">
              <Icon name="printer" className="h-4 w-4" />
              {t('stockOut.printVoucher')}
            </Btn>
            <Btn onClick={handleExportCsv} className="!min-h-9 !py-1 text-xs">
              <Icon name="download" className="h-4 w-4" />
              CSV
            </Btn>
            {doc.status === 'draft' && (
              <>
                <Btn
                  onClick={() => go(`/stock-out/edit/${doc.id}`)}
                  className="!min-h-9 !py-1 text-xs"
                >
                  <Icon name="edit" className="h-4 w-4" />
                  {t('edit')}
                </Btn>
                <Btn
                  variant="primary"
                  onClick={handleConfirm}
                  disabled={confirming}
                  className="!min-h-9 !py-1 text-xs !bg-emerald-600 hover:!bg-emerald-500"
                >
                  <Icon name="check" className="h-4 w-4" />
                  {confirming ? t('loading') : t('stockOut.confirmDocument')}
                </Btn>
                <Btn
                  variant="danger"
                  onClick={handleDeleteDraft}
                  className="!min-h-9 !py-1 text-xs"
                >
                  <Icon name="trash" className="h-4 w-4" />
                  {t('delete')}
                </Btn>
              </>
            )}
            {doc.status === 'confirmed' && (
              <>
                <Btn
                  onClick={handleDuplicate}
                  disabled={actionLoading}
                  className="!min-h-9 !py-1 text-xs"
                >
                  <Icon name="copy" className="h-4 w-4" />
                  {t('stockOut.duplicateAsDraft')}
                </Btn>
                <Btn
                  variant="danger"
                  onClick={handleOpenReverseModal}
                  className="!min-h-9 !py-1 text-xs"
                >
                  <Icon name="undo" className="h-4 w-4" />
                  {t('stockOut.reverseDoc')}
                </Btn>
              </>
            )}
            {doc.status === 'reversed' && (
              <Btn
                onClick={handleDuplicate}
                disabled={actionLoading}
                className="!min-h-9 !py-1 text-xs"
              >
                <Icon name="copy" className="h-4 w-4" />
                {t('stockOut.duplicateAsDraft')}
              </Btn>
            )}
          </div>
        </div>

        {/* PRINTABLE VOUCHER CONTAINER */}
        <div className="printable-voucher rounded-2xl border border-line bg-panel p-6 shadow-xl print:m-0 print:border-none print:p-0 print:shadow-none print:bg-white print:text-black">
          {/* HEADER */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-line pb-4 print:border-black/30">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-black tracking-widest text-accent uppercase print:text-black">
                  SMART INVENTORY
                </span>
                <span className="text-xs text-white/40 print:text-black/60">· WMS PRO</span>
              </div>
              <h1 className="text-2xl font-black tracking-tight print:text-black">
                {settings.lang === 'ar' ? 'سند صرف مخزني' : 'BON DE SORTIE DE STOCK'}
              </h1>
              <p className="text-xs text-white/60 print:text-black/70">
                GOODS ISSUE VOUCHER · {doc.warehouse}
              </p>
            </div>

            {/* BARCODE OF DOCUMENT NUMBER */}
            <div className="flex flex-col items-center sm:items-end">
              <div className="rounded-lg bg-white p-1.5 shadow-sm">
                <BarcodeView text={doc.docNo} height={48} moduleWidth={1.8} fontSize={11} />
              </div>
              <span className="mt-1 text-xs font-mono font-semibold print:text-black">
                {doc.docNo}
              </span>
            </div>
          </div>

          {/* REVERSED BANNER */}
          {doc.status === 'reversed' && (
            <div className="my-4 rounded-xl border border-red-500/40 bg-red-500/15 p-4 text-red-200 print:border-red-600 print:bg-red-50 print:text-red-800">
              <div className="flex items-center gap-2 font-bold">
                <Icon name="alert" className="h-5 w-5" />
                <span>
                  {settings.lang === 'ar'
                    ? 'تم إلغاء هذا السند وإعادة الكميات إلى المخزون'
                    : 'DOCUMENT ANNULÉ / SORTIE INVERSÉE - Stock restauré'}
                </span>
              </div>
              {doc.reversalReason && (
                <p className="mt-1 text-xs">
                  <strong>{settings.lang === 'ar' ? 'السبب:' : 'Motif :'}</strong> {doc.reversalReason}
                </p>
              )}
              {doc.reversedAt && (
                <p className="text-[11px] opacity-80">
                  {fmtDateTime(doc.reversedAt, settings.lang)} · {doc.reversedBy || 'Admin'}
                </p>
              )}
            </div>
          )}

          {/* METADATA GRID */}
          <div className="my-5 grid grid-cols-2 gap-4 rounded-xl bg-panel2/60 p-4 text-xs sm:grid-cols-4 print:bg-gray-100 print:text-black">
            <div>
              <span className="block text-white/40 print:text-black/60">
                {settings.lang === 'ar' ? 'رقم المستند' : 'N° Document'}
              </span>
              <span className="font-bold font-mono text-sm print:text-black">{doc.docNo}</span>
            </div>
            <div>
              <span className="block text-white/40 print:text-black/60">{t('stockOut.date')}</span>
              <span className="font-semibold print:text-black">
                {doc.date} {fmtDateTime(doc.dateTime, settings.lang).split(' ')[1] || ''}
              </span>
            </div>
            <div>
              <span className="block text-white/40 print:text-black/60">{t('stockOut.recipient')}</span>
              <span className="font-bold text-sm text-accent2 print:text-black">{doc.recipient}</span>
            </div>
            <div>
              <span className="block text-white/40 print:text-black/60">{t('stockOut.reason')}</span>
              <span className="font-semibold print:text-black">
                {t(`stockOut.reasons.${doc.reason}`)}
                {doc.customReason ? ` (${doc.customReason})` : ''}
              </span>
            </div>
            <div>
              <span className="block text-white/40 print:text-black/60">{t('stockOut.warehouse')}</span>
              <span className="font-semibold print:text-black">{doc.warehouse}</span>
            </div>
            <div>
              <span className="block text-white/40 print:text-black/60">{t('stockOut.location')}</span>
              <span className="font-semibold print:text-black">
                {doc.zone ? `${t('stockOut.zone')}: ${doc.zone}` : ''}
                {doc.shelf ? ` · ${t('stockOut.shelf')}: ${doc.shelf}` : ''}
                {!doc.zone && !doc.shelf ? '—' : ''}
              </span>
            </div>
            <div>
              <span className="block text-white/40 print:text-black/60">
                {t('stockOut.deliveryRef')}
              </span>
              <span className="font-semibold font-mono print:text-black">
                {doc.deliveryRef || '—'}
              </span>
            </div>
            <div>
              <span className="block text-white/40 print:text-black/60">{t('stockOut.status')}</span>
              <span className="font-bold print:text-black">
                {t(`stockOut.status.${doc.status}`).toUpperCase()}
              </span>
            </div>
          </div>

          {doc.notes && (
            <div className="mb-4 rounded-xl border border-line bg-panel2/30 p-3 text-xs print:border-gray-300 print:bg-white print:text-black">
              <span className="font-semibold text-white/60 print:text-black/70">
                {t('stockOut.notes')}:
              </span>{' '}
              {doc.notes}
            </div>
          )}

          {/* PRODUCTS TABLE */}
          <div className="my-4 overflow-x-auto">
            <table className="w-full text-left text-xs rtl:text-right print:text-black">
              <thead>
                <tr className="border-b-2 border-line text-white/50 print:border-black print:text-black">
                  <th className="py-2.5 px-2 text-center w-8">#</th>
                  <th className="py-2.5 px-2">{t('stockOut.product')}</th>
                  <th className="py-2.5 px-2">{t('stockOut.reference')}</th>
                  <th className="py-2.5 px-2">{t('stockOut.barcode')}</th>
                  <th className="py-2.5 px-2">{t('stockOut.location')}</th>
                  <th className="py-2.5 px-2 text-end">{t('stockOut.quantityOut')}</th>
                  <th className="py-2.5 px-2 text-center">{t('stockOut.unit')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line print:divide-gray-300">
                {doc.lines.map((line, idx) => (
                  <tr
                    key={line.id}
                    className="hover:bg-panel2/50 transition print:hover:bg-transparent"
                  >
                    <td className="py-3 px-2 text-center text-white/40 font-mono print:text-black/60">
                      {idx + 1}
                    </td>
                    <td className="py-3 px-2 font-medium">
                      <div className="flex items-center gap-2">
                        <span className="text-white print:text-black font-semibold">
                          {line.name}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-2 font-mono text-white/70 print:text-black">
                      {line.reference || '—'}
                    </td>
                    <td className="py-3 px-2">
                      {line.barcode ? (
                        <div className="font-mono text-[11px] print:text-black">
                          {line.barcode}
                        </div>
                      ) : (
                        <span className="text-white/30 print:text-black/40">—</span>
                      )}
                    </td>
                    <td className="py-3 px-2 text-white/70 print:text-black">
                      {line.zone ? `${line.zone} ` : ''}
                      {line.shelf ? `[${line.shelf}]` : ''}
                      {!line.zone && !line.shelf ? '—' : ''}
                    </td>
                    <td className="py-3 px-2 text-end font-bold font-mono text-sm text-accent2 print:text-black">
                      {fmtNum(line.quantity)}
                    </td>
                    <td className="py-3 px-2 text-center text-white/60 print:text-black">
                      {t(`unit.${line.unit}`)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line font-bold text-sm bg-panel2/30 print:border-black print:bg-gray-100 print:text-black">
                  <td colSpan={5} className="py-3 px-2 text-end">
                    {settings.lang === 'ar' ? 'الإجمالي العام:' : 'TOTAL GÉNÉRAL :'}
                  </td>
                  <td className="py-3 px-2 text-end font-mono text-lg text-accent2 print:text-black">
                    {fmtNum(doc.totalQuantity)}
                  </td>
                  <td className="py-3 px-2 text-center text-xs text-white/60 print:text-black">
                    {doc.totalLines} {settings.lang === 'ar' ? 'منتجات' : 'articles'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* SIGNATURES BLOCK */}
          <div className="mt-12 grid grid-cols-3 gap-4 border-t border-line pt-6 text-center text-xs print:mt-16 print:border-black print:text-black">
            <div className="flex flex-col items-center justify-between h-28 rounded-xl border border-dashed border-line p-3 print:border-black">
              <span className="font-bold text-white/70 print:text-black">
                {settings.lang === 'ar' ? 'أعدّه (المسؤول المخزني)' : 'Préparé par (Magasinier)'}
              </span>
              <span className="text-[11px] text-white/40 print:text-black/60">
                {doc.confirmedBy || 'Admin'}
              </span>
              <div className="w-full border-t border-line/60 print:border-black/50 pt-1 text-[10px] text-white/30 print:text-black/50">
                {settings.lang === 'ar' ? 'التوقيع' : 'Signature'}
              </div>
            </div>

            <div className="flex flex-col items-center justify-between h-28 rounded-xl border border-dashed border-line p-3 print:border-black">
              <span className="font-bold text-white/70 print:text-black">
                {settings.lang === 'ar' ? 'المستلم / الناقل' : 'Réceptionné par / Livreur'}
              </span>
              <span className="text-[11px] text-white/40 print:text-black/60">
                {doc.recipient}
              </span>
              <div className="w-full border-t border-line/60 print:border-black/50 pt-1 text-[10px] text-white/30 print:text-black/50">
                {settings.lang === 'ar' ? 'التوقيع والتاريخ' : 'Date & Signature'}
              </div>
            </div>

            <div className="flex flex-col items-center justify-between h-28 rounded-xl border border-dashed border-line p-3 print:border-black">
              <span className="font-bold text-white/70 print:text-black">
                {settings.lang === 'ar' ? 'المصادقة / الإدارة' : 'Approuvé par (Direction)'}
              </span>
              <span className="text-[11px] text-white/40 print:text-black/60">
                Visa Responsable
              </span>
              <div className="w-full border-t border-line/60 print:border-black/50 pt-1 text-[10px] text-white/30 print:text-black/50">
                {settings.lang === 'ar' ? 'الختم والتوقيع' : 'Cachet & Signature'}
              </div>
            </div>
          </div>

          {/* FOOTER NOTICE */}
          <div className="mt-8 text-center text-[11px] text-white/30 print:text-black/50">
            SMART INVENTORY · {doc.docNo} · {fmtDateTime(doc.dateTime, settings.lang)} ·{' '}
            {settings.lang === 'ar'
              ? 'وثيقة رسمية صادرة آلياً من نظام إدارة المخزون'
              : 'Document officiel généré automatiquement par SMART INVENTORY'}
          </div>
        </div>
      </Page>

      {/* REVERSAL MODAL */}
      <Modal
        open={showReverseModal}
        onClose={() => setShowReverseModal(false)}
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
            <Btn onClick={() => setShowReverseModal(false)}>{t('cancel')}</Btn>
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

