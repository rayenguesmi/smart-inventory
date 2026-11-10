import { useState, useEffect, useRef, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useApp } from '../context';
import { Shell, Page } from '../components/Shell';
import Scanner from '../components/Scanner';
import { Badge, Btn, Card, Field, Icon, Input, Select, TextArea, Thumb } from '../components/ui';
import { go, goBack, useRoute } from '../router';
import {
  createStockOutDraft,
  updateStockOutDraft,
  confirmStockOut,
  nextStockOutDocNo,
  getAvailableStockForProduct,
  StockOutError,
} from '../lib/stockOut';
import { findProductByCode } from '../lib/products';
import { fmtNum, uid } from '../lib/util';
import type {
  Product,
  StockOutDocument,
  StockOutLine,
  StockOutReason,
} from '../types';

export default function StockOutForm({ id }: { id?: string }) {
  const { t, settings, toast, confirm } = useApp();
  const { query } = useRoute();
  const editing = !!id;

  const existingDoc = useLiveQuery(() => (id ? db.stockOuts.get(id) : undefined), [id]);

  const [docNo, setDocNo] = useState('');
  const [recipient, setRecipient] = useState('');
  const [reason, setReason] = useState<StockOutReason>('customer_delivery');
  const [customReason, setCustomReason] = useState('');
  const [warehouse, setWarehouse] = useState('المستودع الرئيسي');
  const [zone, setZone] = useState('');
  const [shelf, setShelf] = useState('');
  const [deliveryRef, setDeliveryRef] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<StockOutLine[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});

  // Warehouses list
  const warehouses = useLiveQuery(async () => {
    const sessions = await db.sessions.toArray();
    const list = Array.from(new Set(sessions.map((s) => s.warehouse).filter(Boolean)));
    return list.length ? list : ['المستودع الرئيسي', 'Entrepôt Principal'];
  }, []);

  // All products for the picker modal
  const allProducts = useLiveQuery(
    async () => (await db.products.filter((p) => !p.mergedInto).toArray()).sort((a, b) => a.name.localeCompare(b.name)),
    []
  );

  // Initialize new docNo
  useEffect(() => {
    if (!editing) {
      nextStockOutDocNo().then(setDocNo).catch(console.error);
    }
  }, [editing]);

  // Pre-load product if passed in query param (?productId=...)
  useEffect(() => {
    const pid = query?.productId;
    if (!editing && pid) {
      db.products.get(pid).then((prod) => {
        if (prod) addProductToDocument(prod, 1);
      });
    }
  }, [editing, query?.productId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load existing doc
  useEffect(() => {
    if (existingDoc) {
      setDocNo(existingDoc.docNo);
      setRecipient(existingDoc.recipient);
      setReason(existingDoc.reason);
      setCustomReason(existingDoc.customReason ?? '');
      setWarehouse(existingDoc.warehouse);
      setZone(existingDoc.zone ?? '');
      setShelf(existingDoc.shelf ?? '');
      setDeliveryRef(existingDoc.deliveryRef ?? '');
      setNotes(existingDoc.notes ?? '');
      setLines(existingDoc.lines);
    }
  }, [existingDoc]);

  // Re-check available stock for all lines whenever warehouse changes
  useEffect(() => {
    if (!lines.length) return;
    (async () => {
      const updatedLines = [...lines];
      for (const line of updatedLines) {
        const { availableInUnit } = await getAvailableStockForProduct(line.productId, line.unit, warehouse);
        line.availableStock = availableInUnit;
      }
      setLines(updatedLines);
    })();
  }, [warehouse]); // eslint-disable-line react-hooks/exhaustive-deps

  // Helper to add or increment a product line
  const addProductToDocument = async (p: Product, qtyToAdd = 1) => {
    const { availableInUnit } = await getAvailableStockForProduct(p.id, p.unit, warehouse);

    setLines((prev) => {
      const existingIdx = prev.findIndex((l) => l.productId === p.id && l.unit === p.unit);
      if (existingIdx >= 0) {
        const next = [...prev];
        const cur = next[existingIdx];
        const newQty = cur.quantity + qtyToAdd;
        next[existingIdx] = {
          ...cur,
          quantity: newQty,
          availableStock: availableInUnit,
        };
        toast(`${p.name} (+${qtyToAdd} ${cur.unit})`);
        return next;
      }

      const newLine: StockOutLine = {
        id: uid(),
        productId: p.id,
        name: p.name,
        reference: p.reference,
        barcode: p.internalBarcode || p.barcode,
        warehouse,
        zone: zone || undefined,
        shelf: shelf || undefined,
        availableStock: availableInUnit,
        quantity: qtyToAdd,
        unit: p.unit,
        photoId: p.photoIds?.[0],
      };
      toast(`✓ ${p.name}`);
      return [...prev, newLine];
    });
  };

  // Barcode detection handler
  const handleBarcodeDetect = async (code: string) => {
    try {
      const p = await findProductByCode(code);
      if (p) {
        await addProductToDocument(p, 1);
      } else {
        toast(settings.lang === 'ar' ? `منتج غير معروف للباركود: ${code}` : `Produit introuvable: ${code}`, 'err');
      }
    } catch {
      toast(t('err.generic'), 'err');
    }
  };

  const handleManualCodeSubmit = () => {
    const c = manualCode.trim();
    if (!c) return;
    setManualCode('');
    handleBarcodeDetect(c);
  };

  const updateLineQty = (lineId: string, deltaOrExact: number, isExact = false) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== lineId) return l;
        const newQty = isExact ? Math.max(0, deltaOrExact) : Math.max(0, l.quantity + deltaOrExact);
        return { ...l, quantity: newQty };
      }).filter((l) => l.quantity > 0)
    );
  };

  const removeLine = (lineId: string) => {
    setLines((prev) => prev.filter((l) => l.id !== lineId));
  };

  const totalQuantity = useMemo(() => lines.reduce((acc, l) => acc + l.quantity, 0), [lines]);

  // Check if any line violates available stock
  const stockViolations = useMemo(() => {
    return lines.filter((l) => l.quantity > l.availableStock);
  }, [lines]);

  // Validation
  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!recipient.trim()) {
      errors.recipient = settings.lang === 'ar' ? 'يرجى تحديد المستلم أو العميل أو القسم' : 'Destinataire obligatoire';
    }
    if (!warehouse.trim()) {
      errors.warehouse = settings.lang === 'ar' ? 'يرجى تحديد المستودع' : 'Entrepôt obligatoire';
    }
    if (!lines.length) {
      errors.lines = settings.lang === 'ar' ? 'يرجى إضافة منتج واحد على الأقل' : 'Ajoutez au moins un produit';
    }
    setErr(errors);
    return Object.keys(errors).length === 0;
  };

  // Save Draft
  const handleSaveDraft = async () => {
    if (!validateForm()) return;
    setSaving(true);
    try {
      if (editing && id) {
        await updateStockOutDraft(id, {
          recipient,
          reason,
          customReason,
          warehouse,
          zone,
          shelf,
          deliveryRef,
          notes,
          lines,
        });
        toast(t('saved'));
        go('/stock-out/' + id);
      } else {
        const doc = await createStockOutDraft({
          recipient,
          reason,
          customReason,
          warehouse,
          zone,
          shelf,
          deliveryRef,
          notes,
          lines,
        });
        toast(settings.lang === 'ar' ? 'تم حفظ المسودة بنجاح ✓' : 'Brouillon enregistré ✓');
        go('/stock-out/' + doc.id, true);
      }
    } catch (e: any) {
      toast(e?.message ?? t('err.generic'), 'err');
    } finally {
      setSaving(false);
    }
  };

  // Confirm Stock OUT
  const handleOpenConfirmSummary = () => {
    if (!validateForm()) return;
    if (stockViolations.length > 0) {
      toast(
        settings.lang === 'ar'
          ? `لا يمكن التأكيد: هناك ${stockViolations.length} منتج يتجاوز المخزون المتاح!`
          : `Quantité supérieure au stock pour ${stockViolations.length} produit(s)`,
        'err'
      );
      return;
    }
    setSummaryOpen(true);
  };

  const handleExecuteConfirm = async () => {
    setConfirming(true);
    try {
      let docId = id;
      if (!editing || !docId) {
        // Save first as draft
        const draft = await createStockOutDraft({
          recipient,
          reason,
          customReason,
          warehouse,
          zone,
          shelf,
          deliveryRef,
          notes,
          lines,
        });
        docId = draft.id;
      } else {
        await updateStockOutDraft(docId, {
          recipient,
          reason,
          customReason,
          warehouse,
          zone,
          shelf,
          deliveryRef,
          notes,
          lines,
        });
      }

      // Execute atomic confirmation
      await confirmStockOut(docId, 'Admin');
      toast(settings.lang === 'ar' ? 'تم تأكيد خروج المخزون وخصم الكميات بنجاح ✓' : 'Sortie confirmée et stock déduit ✓');
      setSummaryOpen(false);
      go('/stock-out/' + docId, true);
    } catch (e: any) {
      console.error(e);
      if (e instanceof StockOutError && e.code === 'INSUFFICIENT_STOCK') {
        toast(e.message, 'err');
      } else {
        toast(e?.message ?? t('err.generic'), 'err');
      }
    } finally {
      setConfirming(false);
    }
  };

  // Filtered products for modal picker
  const pickerProducts = useMemo(() => {
    if (!allProducts) return [];
    const q = productSearch.trim().toLowerCase();
    if (!q) return allProducts.slice(0, 30);
    return allProducts
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.reference ?? '').toLowerCase().includes(q) ||
          (p.barcode ?? '').includes(q) ||
          (p.internalBarcode ?? '').toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [allProducts, productSearch]);

  return (
    <Shell
      title={editing ? `${settings.lang === 'ar' ? 'تعديل مسودة' : 'Modifier'} ${docNo}` : `${settings.lang === 'ar' ? 'إذن خروج جديد' : 'Nouveau Bon de Sortie'}`}
      back="/stock-out"
    >
      <Page className="pb-32 space-y-4">
        {/* Document Header Card */}
        <Card className="space-y-3">
          <div className="flex items-center justify-between border-b border-line pb-2">
            <div>
              <span className="text-xs text-white/40 block">{t('stockOut.docNo')}</span>
              <span className="font-mono font-bold text-accent2 text-lg">{docNo || 'OUT-......'}</span>
            </div>
            <Badge tone="warn">{t('stockOut.status.draft')}</Badge>
          </div>

          <Field label={t('stockOut.recipient') + ' *'} error={err.recipient}>
            <Input
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={settings.lang === 'ar' ? 'اسم العميل، الموظف، أو القسم المستلم…' : 'Nom du client, employé ou service…'}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t('stockOut.reason')}>
              <Select value={reason} onChange={(e) => setReason(e.target.value as StockOutReason)}>
                <option value="customer_delivery">{t('stockOut.reason.customer_delivery')}</option>
                <option value="internal_consumption">{t('stockOut.reason.internal_consumption')}</option>
                <option value="transfer_warehouse">{t('stockOut.reason.transfer_warehouse')}</option>
                <option value="damaged_products">{t('stockOut.reason.damaged_products')}</option>
                <option value="return_supplier">{t('stockOut.reason.return_supplier')}</option>
                <option value="other">{t('stockOut.reason.other')}</option>
              </Select>
            </Field>

            <Field label={t('stockOut.deliveryRef')}>
              <Input
                value={deliveryRef}
                onChange={(e) => setDeliveryRef(e.target.value)}
                placeholder="BL-2026-001..."
              />
            </Field>
          </div>

          {reason === 'other' && (
            <Field label={settings.lang === 'ar' ? 'توضيح سبب الخروج' : 'Préciser le motif'}>
              <Input
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                placeholder={settings.lang === 'ar' ? 'اكتب السبب…' : 'Motif particulier…'}
              />
            </Field>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Field label={t('stockOut.warehouse') + ' *'} error={err.warehouse}>
              <Select value={warehouse} onChange={(e) => setWarehouse(e.target.value)}>
                {(warehouses ?? []).map((w) => (
                  <option key={w} value={w}>
                    {w}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={settings.lang === 'ar' ? 'المنطقة (Zone)' : 'Zone'}>
              <Input value={zone} onChange={(e) => setZone(e.target.value)} placeholder="Zone A" />
            </Field>
            <Field label={settings.lang === 'ar' ? 'الرف (Shelf)' : 'Rayon'}>
              <Input value={shelf} onChange={(e) => setShelf(e.target.value)} placeholder="Rayon 1" />
            </Field>
          </div>

          <Field label={t('stockOut.notes')}>
            <TextArea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={settings.lang === 'ar' ? 'ملاحظات إضافية…' : 'Remarques éventuelles…'}
              className="!min-h-16"
            />
          </Field>
        </Card>

        {/* Product Addition Section */}
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-bold text-sm">
              {settings.lang === 'ar' ? 'إضافة منتجات للإذن' : 'Articles à sortir'}
            </p>
            <span className="text-xs text-white/50">
              {lines.length} {settings.lang === 'ar' ? 'منتج' : 'articles'} · {fmtNum(totalQuantity)} {settings.lang === 'ar' ? 'وحدة' : 'unités'}
            </span>
          </div>

          {/* Barcode scanner & Manual entry */}
          <div className="flex gap-2">
            <Btn
              variant="primary"
              className="!min-h-12 flex-1"
              onClick={() => setShowScanner(!showScanner)}
            >
              <Icon name="scan" className="h-5 w-5" />
              {showScanner
                ? settings.lang === 'ar' ? 'إغلاق الكاميرا' : 'Fermer caméra'
                : settings.lang === 'ar' ? 'مسح بالباركود' : 'Scanner code-barres'}
            </Btn>
            <Btn className="!min-h-12 flex-1" onClick={() => setShowProductPicker(true)}>
              <Icon name="search" className="h-5 w-5" />
              {settings.lang === 'ar' ? 'بحث واختيار' : 'Choisir produit'}
            </Btn>
          </div>

          {showScanner && (
            <div className="rounded-2xl overflow-hidden border border-accent/40 p-2 bg-black/60">
              <Scanner active={showScanner} paused={false} onDetect={handleBarcodeDetect} />
            </div>
          )}

          <div className="flex gap-2">
            <Input
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleManualCodeSubmit()}
              placeholder={settings.lang === 'ar' ? 'امسح أو اكتب الباركود / المرجع ثم Enter' : 'Code-barres ou réf + Entrée'}
              autoCapitalize="characters"
            />
            <Btn variant="primary" onClick={handleManualCodeSubmit} disabled={!manualCode.trim()}>
              <Icon name="check" />
            </Btn>
          </div>

          {err.lines && <p className="text-xs text-red-400 font-semibold">{err.lines}</p>}
        </Card>

        {/* Warning if stock violated */}
        {stockViolations.length > 0 && (
          <div className="rounded-2xl border border-red-500/50 bg-red-500/10 p-3 text-xs text-red-300 space-y-1">
            <p className="font-bold flex items-center gap-1.5">
              <Icon name="alert" className="h-4 w-4" />
              {settings.lang === 'ar' ? 'تنبيه: الكمية المطلوبة تتجاوز المخزون المتاح!' : 'Attention : Stock disponible dépassé !'}
            </p>
            {stockViolations.map((v) => (
              <p key={v.id} className="ps-5">
                • {v.name}: {settings.lang === 'ar' ? 'مطلوب' : 'demandé'} <b>{v.quantity}</b> {v.unit} ({settings.lang === 'ar' ? 'المتاح فقط' : 'dispo:'} <b>{v.availableStock}</b>)
              </p>
            ))}
          </div>
        )}

        {/* Product Lines List */}
        <div className="space-y-2">
          {lines.length === 0 ? (
            <Card className="text-center py-8 text-white/40 space-y-2">
              <Icon name="box" className="mx-auto h-8 w-8 text-white/20" />
              <p>{settings.lang === 'ar' ? 'لم يتم إضافة أي منتج بعد.' : 'Aucun article ajouté pour le moment.'}</p>
              <p className="text-xs text-white/30">
                {settings.lang === 'ar' ? 'امسح الباركود أو ابحث عن المنتجات لإضافتها.' : 'Scannez un code ou utilisez la recherche.'}
              </p>
            </Card>
          ) : (
            lines.map((line, idx) => {
              const isOverStock = line.quantity > line.availableStock;
              return (
                <div
                  key={line.id}
                  className={`card space-y-2.5 !p-3 border transition ${
                    isOverStock ? 'border-red-500 bg-red-500/5' : 'border-line'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-white/40">#{idx + 1}</span>
                        <p className="font-bold text-sm truncate">{line.name}</p>
                      </div>
                      <p className="text-xs font-mono text-white/50 truncate">
                        {line.reference ? `RÉF: ${line.reference} · ` : ''}
                        <span className="text-accent2">{line.barcode || '—'}</span>
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => removeLine(line.id)}
                      className="text-white/40 hover:text-red-400 p-1"
                      title={t('delete')}
                    >
                      <Icon name="x" className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Stock Availability Indicator & Quantity Control */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-line/40 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-white/50">{t('stockOut.availableStock')}:</span>
                      <span
                        className={`font-mono font-bold ${
                          line.availableStock <= 0 ? 'text-red-400' : 'text-emerald-400'
                        }`}
                      >
                        {fmtNum(line.availableStock)} {line.unit}
                      </span>
                    </div>

                    {/* Stepper & input */}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => updateLineQty(line.id, -1)}
                        className="btn btn-ghost !min-h-8 !min-w-8 !p-1 text-sm font-bold"
                      >
                        -
                      </button>
                      <input
                        type="number"
                        min={1}
                        value={line.quantity}
                        onChange={(e) => updateLineQty(line.id, parseFloat(e.target.value) || 0, true)}
                        className={`input !min-h-8 !w-16 !p-1 text-center font-bold font-mono ${
                          isOverStock ? '!border-red-500 text-red-300' : ''
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => updateLineQty(line.id, 1)}
                        className="btn btn-ghost !min-h-8 !min-w-8 !p-1 text-sm font-bold"
                      >
                        +
                      </button>
                      <span className="text-white/50 ps-1 font-medium">{line.unit}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Action Buttons Bar */}
        <div className="sticky bottom-4 z-20 flex gap-2 pt-2">
          <Btn
            className="flex-1 !min-h-14 font-semibold"
            disabled={saving || confirming || !lines.length}
            onClick={handleSaveDraft}
          >
            <Icon name="file" className="h-5 w-5" />
            {t('stockOut.saveDraft')}
          </Btn>
          <Btn
            variant="primary"
            className="flex-1 !min-h-14 text-base font-bold"
            disabled={saving || confirming || !lines.length || stockViolations.length > 0}
            onClick={handleOpenConfirmSummary}
          >
            <Icon name="check" className="h-5 w-5" />
            {t('stockOut.confirm')}
          </Btn>
        </div>

        {/* Product Picker Modal */}
        {showProductPicker && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
            <Card className="w-full max-w-lg max-h-[85vh] flex flex-col space-y-3 bg-panel p-4 shadow-2xl">
              <div className="flex items-center justify-between border-b border-line pb-2">
                <p className="font-bold text-base">
                  {settings.lang === 'ar' ? 'اختر منتجًا لإضافته' : 'Sélectionner un produit'}
                </p>
                <button onClick={() => setShowProductPicker(false)} className="text-white/60 p-1">
                  <Icon name="x" className="h-5 w-5" />
                </button>
              </div>

              <Input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder={settings.lang === 'ar' ? 'بحث بالاسم، المرجع، الباركود…' : 'Rechercher nom, réf, code…'}
                autoFocus
              />

              <div className="flex-1 overflow-y-auto space-y-2 min-h-[250px]">
                {pickerProducts.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      addProductToDocument(p, 1);
                      setShowProductPicker(false);
                    }}
                    className="card w-full flex items-center justify-between gap-3 !p-2.5 text-start hover:bg-panel2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm truncate">{p.name}</p>
                      <p className="text-xs font-mono text-white/50 truncate">
                        {p.reference ? `${p.reference} · ` : ''}
                        <span className="text-accent2">{p.internalBarcode || p.barcode || '—'}</span>
                      </p>
                    </div>
                    <span className="shrink-0 chip text-xs font-semibold">{p.unit}</span>
                  </button>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* Confirmation Summary Modal */}
        {summaryOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4">
            <Card className="w-full max-w-md space-y-4 bg-panel border-accent2/40 p-4 shadow-2xl">
              <div className="flex items-center gap-3 border-b border-line pb-2">
                <div className="rounded-xl bg-accent2/20 p-2 text-accent2">
                  <Icon name="check" className="h-6 w-6" />
                </div>
                <div>
                  <p className="font-bold text-base">{t('stockOut.confirmTitle')}</p>
                  <p className="text-xs font-mono text-white/50">{docNo}</p>
                </div>
              </div>

              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                <dt className="text-white/50">{t('stockOut.recipient')}:</dt>
                <dd className="font-semibold">{recipient}</dd>
                <dt className="text-white/50">{t('stockOut.reason')}:</dt>
                <dd>{t('stockOut.reason.' + reason)}</dd>
                <dt className="text-white/50">{t('stockOut.warehouse')}:</dt>
                <dd>{warehouse}</dd>
                <dt className="text-white/50">{settings.lang === 'ar' ? 'إجمالي المنتجات' : 'Nombre d’articles'}:</dt>
                <dd className="font-bold text-white">{lines.length}</dd>
                <dt className="text-white/50">{settings.lang === 'ar' ? 'إجمالي الكميات' : 'Total quantité'}:</dt>
                <dd className="font-bold text-emerald-400 text-sm">{fmtNum(totalQuantity)}</dd>
              </dl>

              <div className="rounded-xl bg-amber-500/15 p-3 text-xs text-amber-200 space-y-1">
                <p className="font-semibold flex items-center gap-1.5">
                  <Icon name="alert" className="h-4 w-4" />
                  {settings.lang === 'ar' ? 'تنبيه تدقيق المخزون' : 'Confirmation irréversible'}
                </p>
                <p>
                  {settings.lang === 'ar'
                    ? 'سيتم خصم الكميات من المخزون فورًا وإنشاء حركة خروج رسمية. لا يمكن تعديل الكميات بعد التأكيد إلا عن طريق إجراء الإلغاء/العكس.'
                    : 'Cette action déduira immédiatement les quantités en stock. Une fois confirmé, le bon ne peut être annulé que par une opération d’inversion contrôlée.'}
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <Btn className="flex-1" onClick={() => setSummaryOpen(false)} disabled={confirming}>
                  {t('cancel')}
                </Btn>
                <Btn
                  variant="primary"
                  className="flex-1 !min-h-12 font-bold"
                  disabled={confirming}
                  onClick={handleExecuteConfirm}
                >
                  <Icon name="check" className="h-4 w-4" />
                  {confirming ? t('loading') : t('confirm')}
                </Btn>
              </div>
            </Card>
          </div>
        )}
      </Page>
    </Shell>
  );
}
