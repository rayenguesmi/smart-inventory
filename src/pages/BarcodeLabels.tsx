import { useMemo, useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useApp } from '../context';
import { Shell, Page } from '../components/Shell';
import { Btn, Card, Icon, Input, Select } from '../components/ui';
import { useRoute } from '../router';
import { BarcodeView } from '../components/BarcodeView';
import type { Product } from '../types';

type SheetTemplate = 'a4_24' | 'a4_14' | 'a4_40' | 'single';
type BarcodeChoice = 'internal' | 'original' | 'both';

interface SheetConfig {
  name: string;
  cols: number;
  rowsPerPage: number;
  labelWidthMm: number;
  labelHeightMm: number;
  className: string;
}

const TEMPLATES: Record<SheetTemplate, SheetConfig> = {
  a4_24: {
    name: 'A4 · 24 ملصقات (3×8) · 70×37mm',
    cols: 3,
    rowsPerPage: 8,
    labelWidthMm: 70,
    labelHeightMm: 37,
    className: 'grid-cols-3',
  },
  a4_14: {
    name: 'A4 · 14 ملصق (2×7) · 105×42mm',
    cols: 2,
    rowsPerPage: 7,
    labelWidthMm: 105,
    labelHeightMm: 42,
    className: 'grid-cols-2',
  },
  a4_40: {
    name: 'A4 · 40 ملصق (4×10) · 52×29mm',
    cols: 4,
    rowsPerPage: 10,
    labelWidthMm: 52,
    labelHeightMm: 29,
    className: 'grid-cols-4',
  },
  single: {
    name: 'ملصق فردي / طابعة رول (Single/Roll)',
    cols: 1,
    rowsPerPage: 1,
    labelWidthMm: 80,
    labelHeightMm: 50,
    className: 'grid-cols-1',
  },
};

export default function BarcodeLabels() {
  const { t, settings, unitLabel } = useApp();
  const { query } = useRoute();
  const [q, setQ] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [template, setTemplate] = useState<SheetTemplate>('a4_24');
  const [barcodeChoice, setBarcodeChoice] = useState<BarcodeChoice>('internal');
  const [showRef, setShowRef] = useState(true);
  const [showCategory, setShowCategory] = useState(false);
  const [previewTab, setPreviewTab] = useState<'selection' | 'preview'>('selection');

  const allProducts = useLiveQuery(
    async () => (await db.products.filter((p) => !p.mergedInto).toArray()).sort((a, b) => a.name.localeCompare(b.name)),
    []
  );

  // Pre-select product if ?id= was provided in URL
  useEffect(() => {
    if (query.id && allProducts) {
      setSelectedIds(new Set([query.id]));
      setQuantities((prev) => ({ ...prev, [query.id]: 1 }));
    }
  }, [query.id, allProducts]);

  const filteredProducts = useMemo(() => {
    if (!allProducts) return [];
    const s = q.trim().toLowerCase();
    if (!s) return allProducts;
    return allProducts.filter(
      (p) =>
        p.name.toLowerCase().includes(s) ||
        (p.reference ?? '').toLowerCase().includes(s) ||
        (p.internalBarcode ?? '').toLowerCase().includes(s) ||
        (p.barcode ?? '').toLowerCase().includes(s) ||
        (p.originalBarcode ?? '').toLowerCase().includes(s) ||
        (p.category ?? '').toLowerCase().includes(s)
    );
  }, [allProducts, q]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        if (!quantities[id]) {
          setQuantities((qMap) => ({ ...qMap, [id]: 1 }));
        }
      }
      return next;
    });
  };

  const selectAll = () => {
    const next = new Set<string>();
    const nextQty = { ...quantities };
    for (const p of filteredProducts) {
      next.add(p.id);
      if (!nextQty[p.id]) nextQty[p.id] = 1;
    }
    setSelectedIds(next);
    setQuantities(nextQty);
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const setQty = (id: string, qty: number) => {
    const val = Math.max(1, Math.min(500, Math.floor(qty) || 1));
    setQuantities((prev) => ({ ...prev, [id]: val }));
  };

  const setAllQuantities = (n: number) => {
    const next: Record<string, number> = {};
    for (const id of selectedIds) next[id] = n;
    setQuantities(next);
  };

  // Build the list of labels to print/preview
  const labelsToRender = useMemo(() => {
    if (!allProducts) return [];
    const map = new Map(allProducts.map((p) => [p.id, p]));
    const list: Product[] = [];
    for (const id of selectedIds) {
      const p = map.get(id);
      if (!p) continue;
      const count = quantities[id] || 1;
      for (let i = 0; i < count; i++) {
        list.push(p);
      }
    }
    return list;
  }, [allProducts, selectedIds, quantities]);

  const handlePrint = () => {
    window.print();
  };

  const getBarcodeValue = (p: Product, mode: 'primary' | 'secondary' = 'primary'): string => {
    if (barcodeChoice === 'internal') {
      return p.internalBarcode || p.barcode || p.reference || '';
    }
    if (barcodeChoice === 'original') {
      return p.originalBarcode || p.barcode || p.internalBarcode || '';
    }
    // both
    if (mode === 'primary') {
      return p.internalBarcode || p.barcode || '';
    }
    return p.originalBarcode || '';
  };

  const config = TEMPLATES[template];

  return (
    <Shell title={settings.lang === 'ar' ? 'ملصقات الباركود' : 'Étiquettes Code-barres'} back="/more">
      {/* Print-only CSS injected */}
      <style>{`
        @media print {
          body {
            background: white !important;
            color: black !important;
          }
          header, nav, .no-print {
            display: none !important;
          }
          main {
            overflow: visible !important;
            height: auto !important;
          }
          .print-area {
            display: block !important;
            width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .label-page {
            page-break-after: always;
            break-after: page;
          }
          .sticker-item {
            box-sizing: border-box;
            border: 1px dashed #ccc !important;
            page-break-inside: avoid;
            break-inside: avoid;
          }
        }
      `}</style>

      <Page className="no-print">
        {/* Navigation Tabs */}
        <div className="flex rounded-2xl bg-panel2 p-1">
          <button
            onClick={() => setPreviewTab('selection')}
            className={`flex-1 rounded-xl py-2.5 text-center text-sm font-semibold transition ${
              previewTab === 'selection' ? 'bg-accent2 text-ink shadow' : 'text-white/60 hover:text-white'
            }`}
          >
            {settings.lang === 'ar' ? `اختيار المنتجات (${selectedIds.size})` : `Sélectionner (${selectedIds.size})`}
          </button>
          <button
            onClick={() => setPreviewTab('preview')}
            className={`flex-1 rounded-xl py-2.5 text-center text-sm font-semibold transition ${
              previewTab === 'preview' ? 'bg-accent2 text-ink shadow' : 'text-white/60 hover:text-white'
            }`}
          >
            {settings.lang === 'ar'
              ? `معاينة وطباعة (${labelsToRender.length})`
              : `Aperçu & Impression (${labelsToRender.length})`}
          </button>
        </div>

        {previewTab === 'selection' ? (
          <div className="space-y-3">
            {/* Search & Bulk Select Controls */}
            <div className="relative">
              <Icon
                name="search"
                className="pointer-events-none absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-white/30"
              />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={settings.lang === 'ar' ? 'بحث بالاسم، المرجع، الباركود…' : 'Rechercher par nom, réf, code…'}
                className="!ps-12"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-2">
                <Btn onClick={selectAll} className="text-xs">
                  <Icon name="check" className="h-4 w-4" /> {settings.lang === 'ar' ? 'تحديد الكل' : 'Tout sélectionner'}
                </Btn>
                {selectedIds.size > 0 && (
                  <Btn onClick={clearSelection} className="text-xs text-red-400">
                    <Icon name="x" className="h-4 w-4" /> {settings.lang === 'ar' ? 'إلغاء التحديد' : 'Désélectionner'}
                  </Btn>
                )}
              </div>
              <span className="text-xs text-white/50">
                {selectedIds.size} {settings.lang === 'ar' ? 'منتج محدد' : 'produits sélectionnés'} (
                {labelsToRender.length} {settings.lang === 'ar' ? 'ملصق' : 'étiquettes'})
              </span>
            </div>

            {/* Quick Bulk Quantity Adjust */}
            {selectedIds.size > 0 && (
              <Card className="flex flex-wrap items-center gap-2 !p-3 text-xs">
                <span className="text-white/60">{settings.lang === 'ar' ? 'الكمية للكل:' : 'Quantité par produit:'}</span>
                <button onClick={() => setAllQuantities(1)} className="chip !px-2.5 !py-1">
                  1
                </button>
                <button onClick={() => setAllQuantities(2)} className="chip !px-2.5 !py-1">
                  2
                </button>
                <button onClick={() => setAllQuantities(5)} className="chip !px-2.5 !py-1">
                  5
                </button>
                <button onClick={() => setAllQuantities(10)} className="chip !px-2.5 !py-1">
                  10
                </button>
                <Btn
                  variant="primary"
                  className="!min-h-8 ms-auto text-xs"
                  onClick={() => setPreviewTab('preview')}
                >
                  {settings.lang === 'ar' ? 'معاينة الملصقات ←' : 'Voir les étiquettes →'}
                </Btn>
              </Card>
            )}

            {/* Product List with Checkboxes and Quantity pickers */}
            <div className="space-y-2">
              {filteredProducts.map((p) => {
                const isSelected = selectedIds.has(p.id);
                const qty = quantities[p.id] || 1;
                return (
                  <div
                    key={p.id}
                    className={`card flex items-center gap-3 !p-3 transition ${
                      isSelected ? 'border-accent2/60 bg-accent2/5' : 'opacity-80'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(p.id)}
                      className="h-6 w-6 rounded accent-[#2f7bff]"
                    />
                    <div className="min-w-0 flex-1" onClick={() => toggleSelect(p.id)}>
                      <p className="truncate font-semibold">{p.name}</p>
                      <p className="truncate text-xs font-mono text-white/50">
                        {p.reference ? `${p.reference} · ` : ''}
                        <span className="text-accent2">{p.internalBarcode || p.barcode || '—'}</span>
                        {p.originalBarcode && p.originalBarcode !== p.internalBarcode && (
                          <span className="text-white/40"> · Orig: {p.originalBarcode}</span>
                        )}
                      </p>
                    </div>
                    {isSelected && (
                      <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="btn btn-ghost !min-h-8 !min-w-8 !p-1 text-sm"
                          onClick={() => setQty(p.id, qty - 1)}
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={500}
                          value={qty}
                          onChange={(e) => setQty(p.id, parseInt(e.target.value, 10))}
                          className="input !min-h-8 !w-14 !p-1 text-center font-bold"
                        />
                        <button
                          type="button"
                          className="btn btn-ghost !min-h-8 !min-w-8 !p-1 text-sm"
                          onClick={() => setQty(p.id, qty + 1)}
                        >
                          +
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Sheet Settings */}
            <Card className="space-y-3">
              <p className="font-semibold">{settings.lang === 'ar' ? 'إعدادات ورقة الملصقات' : 'Format de planche'}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className="label text-xs">{settings.lang === 'ar' ? 'نوع الورقة / المقاس' : 'Format feuille'}</label>
                  <Select value={template} onChange={(e) => setTemplate(e.target.value as SheetTemplate)}>
                    {(Object.keys(TEMPLATES) as SheetTemplate[]).map((k) => (
                      <option key={k} value={k}>
                        {t('labels.tpl_' + k) || TEMPLATES[k].name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="label text-xs">{settings.lang === 'ar' ? 'الباركود المعروض' : 'Code-barres à imprimer'}</label>
                  <Select value={barcodeChoice} onChange={(e) => setBarcodeChoice(e.target.value as BarcodeChoice)}>
                    <option value="internal">{settings.lang === 'ar' ? 'الباركود الداخلي الدائم (INV-xxxxxx)' : 'Code interne (INV-xxxxxx)'}</option>
                    <option value="original">{settings.lang === 'ar' ? 'باركود المصنّع الأصلي (إن وجد)' : "Code d'origine fabricant"}</option>
                    <option value="both">{settings.lang === 'ar' ? 'الباركود الداخلي + الأصلي معًا' : 'Les deux codes'}</option>
                  </Select>
                </div>
              </div>

              <div className="flex flex-wrap gap-4 pt-1 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showRef}
                    onChange={(e) => setShowRef(e.target.checked)}
                    className="h-4 w-4 rounded accent-[#2f7bff]"
                  />
                  <span>{settings.lang === 'ar' ? 'إظهار المرجع (Référence)' : 'Afficher la référence'}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showCategory}
                    onChange={(e) => setShowCategory(e.target.checked)}
                    className="h-4 w-4 rounded accent-[#2f7bff]"
                  />
                  <span>{settings.lang === 'ar' ? 'إظهار الفئة والوحدة' : 'Afficher catégorie & unité'}</span>
                </label>
              </div>

              <div className="flex gap-2 pt-2">
                <Btn variant="primary" className="flex-1 !min-h-12" onClick={handlePrint}>
                  <Icon name="printer" className="h-5 w-5" />
                  {settings.lang === 'ar' ? 'طباعة الملصقات (A4 / Sticker Sheet)' : 'Imprimer les étiquettes'}
                </Btn>
                <Btn className="!min-h-12" onClick={handlePrint}>
                  <Icon name="download" className="h-5 w-5" /> PDF
                </Btn>
              </div>
            </Card>

            {/* Preview Banner */}
            <div className="flex items-center justify-between text-xs text-white/60">
              <span>{settings.lang === 'ar' ? 'معاينة حية للملصقات:' : 'Aperçu avant impression:'}</span>
              <span>{labelsToRender.length} {settings.lang === 'ar' ? 'ملصق' : 'étiquettes'}</span>
            </div>

            {labelsToRender.length === 0 ? (
              <Card className="text-center py-8 text-white/50">
                {settings.lang === 'ar' ? 'لم يتم اختيار أي منتج للطباعة.' : 'Aucun produit sélectionné.'}
              </Card>
            ) : null}
          </div>
        )}
      </Page>

      {/* RENDERED LABELS SHEET (Visible on preview screen & printable) */}
      {(previewTab === 'preview' || typeof window !== 'undefined') && labelsToRender.length > 0 && (
        <div className="print-area p-4 bg-neutral-900 overflow-x-auto">
          <div
            className={`mx-auto bg-white text-black p-4 rounded-xl shadow-2xl grid gap-2 ${config.className}`}
            style={{
              maxWidth: template === 'single' ? '400px' : '900px',
              minHeight: '400px',
            }}
          >
            {labelsToRender.map((p, idx) => {
              const primaryBc = getBarcodeValue(p, 'primary');
              const secondaryBc = barcodeChoice === 'both' ? getBarcodeValue(p, 'secondary') : null;
              return (
                <div
                  key={`${p.id}-${idx}`}
                  className="sticker-item border border-black/20 rounded-md p-2 flex flex-col justify-between items-center text-center bg-white shadow-sm"
                  style={{
                    minHeight: template === 'a4_40' ? '95px' : template === 'a4_24' ? '125px' : '150px',
                  }}
                >
                  {/* Product Header */}
                  <div className="w-full">
                    <p className="font-bold text-black text-xs md:text-sm leading-tight line-clamp-1">
                      {p.name}
                    </p>
                    {showRef && (
                      <p className="font-mono text-[11px] text-neutral-600 font-semibold truncate">
                        {p.reference ? `RÉF: ${p.reference}` : ''}
                      </p>
                    )}
                    {showCategory && (
                      <p className="text-[10px] text-neutral-500 truncate">
                        {p.category ? `${p.category} · ` : ''}
                        {unitLabel(p.unit)}
                      </p>
                    )}
                  </div>

                  {/* High-Contrast Code 128 Barcode Image */}
                  <div className="my-1 flex flex-col items-center justify-center w-full max-w-[95%]">
                    <BarcodeView
                      text={primaryBc}
                      height={template === 'a4_40' ? 36 : template === 'a4_24' ? 44 : 54}
                      moduleWidth={1.5}
                      showText={true}
                      fontSize={11}
                      className="w-full"
                    />
                    {secondaryBc && secondaryBc !== primaryBc && (
                      <p className="text-[9px] font-mono text-neutral-600 mt-0.5">
                        Orig: {secondaryBc}
                      </p>
                    )}
                  </div>

                  {/* Footer note */}
                  <div className="w-full flex justify-between items-center text-[9px] text-neutral-400 border-t border-neutral-100 pt-0.5">
                    <span>SMART INVENTORY</span>
                    <span className="font-mono">{p.internalBarcode || ''}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Shell>
  );
}

