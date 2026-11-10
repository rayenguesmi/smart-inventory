import { useState, useRef, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useApp } from '../context';
import { Shell, Page } from '../components/Shell';
import { Btn, Card, Icon, Input, Select, Spinner } from '../components/ui';
import { parseSpreadsheet, type ParsedSheet } from '../lib/io';
import {
  autoMapColumns,
  analyzeProductImport,
  executeProductImport,
  downloadErrorReport,
  exportProductMasterCsv,
  exportDetailedStockCsv,
  CSV_IMPORT_FIELDS,
  type CsvMapping,
  type CsvImportField,
  type ImportAnalysis,
  type ImportMode,
  type ImportExecutionResult,
} from '../lib/csvManager';

export default function CsvManagement() {
  const { t, settings, toast, confirm } = useApp();
  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export');

  // Export state
  const [delimiter, setDelimiter] = useState<';' | ','>(';');
  const [protectText, setProtectText] = useState(true);
  const [filterCat, setFilterCat] = useState('');
  const [filterWh, setFilterWh] = useState('');
  const [filterZone, setFilterZone] = useState('');
  const [filterShelf, setFilterShelf] = useState('');
  const [filterStockStatus, setFilterStockStatus] = useState<
    'all' | 'low' | 'zero' | 'no_barcode' | 'unknown'
  >('all');
  const [exportBusy, setExportBusy] = useState(false);

  // Import state
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [importMode, setImportMode] = useState<ImportMode>('update_existing');
  const [openingSessionName, setOpeningSessionName] = useState('');
  const [warehouseName, setWarehouseName] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportExecutionResult | null>(null);
  const [importError, setImportError] = useState('');

  // Categories & Warehouses for filter dropdowns
  const categories = useLiveQuery(async () => {
    const prods = await db.products.filter((p) => !p.mergedInto && !!p.category).toArray();
    return Array.from(new Set(prods.map((p) => p.category!))).sort();
  }, []);

  const warehouses = useLiveQuery(async () => {
    const sessions = await db.sessions.toArray();
    return Array.from(new Set(sessions.map((s) => s.warehouse).filter(Boolean))).sort();
  }, []);

  const zones = useLiveQuery(async () => {
    const locs = await db.locations.toArray();
    return Array.from(new Set(locs.map((l) => l.zone).filter(Boolean))).sort();
  }, []);

  const shelves = useLiveQuery(async () => {
    const locs = await db.locations.toArray();
    return Array.from(new Set(locs.map((l) => l.shelf).filter(Boolean))).sort();
  }, []);

  // ---------------------------------------------------------------------------
  // EXPORT HANDLERS
  // ---------------------------------------------------------------------------

  const handleExportMaster = async (isAll = false) => {
    setExportBusy(true);
    try {
      await exportProductMasterCsv({
        delimiter,
        excelTextProtection: protectText,
        filterCategory: isAll ? undefined : filterCat || undefined,
        filterWarehouse: isAll ? undefined : filterWh || undefined,
        filterZone: isAll ? undefined : filterZone || undefined,
        filterShelf: isAll ? undefined : filterShelf || undefined,
        filterStockStatus: isAll ? 'all' : filterStockStatus,
      });
      toast(settings.lang === 'ar' ? 'تم تصدير ملف المنتجات بنجاح ✓' : 'Export du catalogue réussi ✓');
    } catch (e) {
      console.error(e);
      toast(t('err.export'), 'err');
    } finally {
      setExportBusy(false);
    }
  };

  const handleExportDetailed = async () => {
    setExportBusy(true);
    try {
      await exportDetailedStockCsv({
        delimiter,
        excelTextProtection: protectText,
        filterCategory: filterCat || undefined,
        filterWarehouse: filterWh || undefined,
        filterZone: filterZone || undefined,
        filterShelf: filterShelf || undefined,
      });
      toast(settings.lang === 'ar' ? 'تم تصدير تفاصيل المخزون بنجاح ✓' : 'Export du stock détaillé réussi ✓');
    } catch (e) {
      console.error(e);
      toast(t('err.export'), 'err');
    } finally {
      setExportBusy(false);
    }
  };

  // ---------------------------------------------------------------------------
  // IMPORT HANDLERS
  // ---------------------------------------------------------------------------

  const handleFileSelect = async (f: File, sheetName?: string) => {
    setAnalyzing(true);
    setImportError('');
    setAnalysis(null);
    setImportResult(null);
    try {
      const p = await parseSpreadsheet(f, sheetName);
      if (p.rows.length < 2) throw new Error('EMPTY');
      setFile(f);
      setParsed(p);
      const autoMap = autoMapColumns(p.rows[0]);
      setMapping(autoMap);

      // Analyze automatically
      const res = await analyzeProductImport(p.rows, autoMap);
      setAnalysis(res);
    } catch {
      setImportError(t('import.readError'));
      setParsed(null);
    } finally {
      setAnalyzing(false);
    }
  };

  const reanalyze = async (newMap: CsvMapping) => {
    if (!parsed) return;
    setAnalyzing(true);
    try {
      const res = await analyzeProductImport(parsed.rows, newMap);
      setAnalysis(res);
    } catch (e) {
      console.error(e);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleExecuteImport = async () => {
    if (!analysis) return;

    if (importMode === 'opening_balance') {
      const confirmed = await confirm({
        title: settings.lang === 'ar' ? 'تأكيد استيراد الرصيد الافتتاحي' : "Confirmer l'import du solde initial",
        message:
          settings.lang === 'ar'
            ? 'سيتم تسجيل كميات المخزون كرصيد افتتاحي في جلسة جديدة دون مسح سجلات الجرد السابقة. هل تريد المتابعة؟'
            : 'Les quantités seront importées comme solde initial dans une session traçable sans effacer votre historique. Continuer ?',
        confirmLabel: settings.lang === 'ar' ? 'نعم، استيراد الرصيد' : 'Oui, importer le solde',
      });
      if (!confirmed) return;
    }

    setImporting(true);
    try {
      const result = await executeProductImport(analysis, {
        mode: importMode,
        openingSessionName: openingSessionName.trim() || undefined,
        warehouseName: warehouseName.trim() || undefined,
      });
      setImportResult(result);
      toast(
        settings.lang === 'ar'
          ? `تم الاستيراد بنجاح: ${result.created} جديد، ${result.updated} تم تحديثه ✓`
          : `Import terminé: ${result.created} créés, ${result.updated} mis à jour ✓`
      );
    } catch (e) {
      console.error(e);
      setImportError(t('err.generic'));
    } finally {
      setImporting(false);
    }
  };

  const headers = parsed?.rows[0] ?? [];

  return (
    <Shell title={settings.lang === 'ar' ? 'إدارة ملفات CSV' : 'Gestion CSV'} back="/more">
      <Page>
        {/* Module Header Tabs */}
        <div className="flex rounded-2xl bg-panel2 p-1">
          <button
            onClick={() => setActiveTab('export')}
            className={`flex-1 rounded-xl py-2.5 text-center text-sm font-semibold transition ${
              activeTab === 'export' ? 'bg-accent2 text-ink shadow' : 'text-white/60 hover:text-white'
            }`}
          >
            <Icon name="download" className="inline-block me-1.5 h-4 w-4" />
            {settings.lang === 'ar' ? 'تصدير المنتجات (CSV / Excel)' : 'Exporter (CSV / Excel)'}
          </button>
          <button
            onClick={() => setActiveTab('import')}
            className={`flex-1 rounded-xl py-2.5 text-center text-sm font-semibold transition ${
              activeTab === 'import' ? 'bg-accent2 text-ink shadow' : 'text-white/60 hover:text-white'
            }`}
          >
            <Icon name="upload" className="inline-block me-1.5 h-4 w-4" />
            {settings.lang === 'ar' ? 'استيراد وتحديث CSV' : 'Importer & Mettre à jour'}
          </button>
        </div>

        {/* ----------------------------------------------------------------- */}
        {/* TAB 1: CSV EXPORT                                                 */}
        {/* ----------------------------------------------------------------- */}
        {activeTab === 'export' ? (
          <div className="space-y-4">
            {/* Quick Export All One-Click Card */}
            <Card className="space-y-3 border-accent2/40 bg-accent2/5">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-accent2/20 p-2.5 text-accent2">
                  <Icon name="database" className="h-6 w-6" />
                </div>
                <div>
                  <p className="font-bold text-base">
                    {settings.lang === 'ar' ? 'تصدير شامل لكامل قاعدة البيانات' : 'Export global du catalogue'}
                  </p>
                  <p className="text-xs text-white/60">
                    {settings.lang === 'ar'
                      ? 'يحتوي على كافة المنتجات الـ 19 حقلًا بما فيها الباركود الداخلي والأصلي والمخزون'
                      : 'Contient l’ensemble des 19 colonnes, codes internes, codes fabricants et stocks'}
                  </p>
                </div>
              </div>

              <Btn
                variant="primary"
                className="w-full !min-h-14 text-base font-bold"
                disabled={exportBusy}
                onClick={() => handleExportMaster(true)}
              >
                <Icon name="download" className="h-5 w-5" />
                {settings.lang === 'ar' ? 'تصدير كافة المنتجات إلى CSV (19 عمود)' : 'EXPORTER TOUS LES PRODUITS EN CSV'}
              </Btn>
            </Card>

            {/* Export Settings & Delimiter */}
            <Card className="space-y-3">
              <p className="font-semibold text-sm">
                {settings.lang === 'ar' ? 'خيارات التوافق مع Microsoft Excel' : 'Options de format Excel'}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label text-xs">
                    {settings.lang === 'ar' ? 'الفاصل (Delimiter)' : 'Séparateur'}
                  </label>
                  <Select value={delimiter} onChange={(e) => setDelimiter(e.target.value as ';' | ',')}>
                    <option value=";">{settings.lang === 'ar' ? 'نقطة وفاصلة (;) - قياسي لـ Excel العربي/الفرنسي' : 'Point-virgule (;) - Standard Excel'}</option>
                    <option value=",">{settings.lang === 'ar' ? 'فاصلة (,) - دولي' : 'Virgule (,)'}</option>
                  </Select>
                </div>
                <div className="flex flex-col justify-end">
                  <label className="flex items-center gap-2 cursor-pointer pb-2 text-xs">
                    <input
                      type="checkbox"
                      checked={protectText}
                      onChange={(e) => setProtectText(e.target.checked)}
                      className="h-4 w-4 rounded accent-[#2f7bff]"
                    />
                    <span>
                      {settings.lang === 'ar'
                        ? 'حماية الباركود من التحويل العلمي (="00123")'
                        : 'Préserver zéros et codes-barres'}
                    </span>
                  </label>
                </div>
              </div>
            </Card>

            {/* Filtered Export Section */}
            <Card className="space-y-3">
              <p className="font-semibold text-sm">
                {settings.lang === 'ar' ? 'تصفية المنتجات قبل التصدير' : 'Filtres d’exportation'}
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="label text-[11px]">{settings.lang === 'ar' ? 'الفئة' : 'Catégorie'}</label>
                  <Select value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
                    <option value="">— {settings.lang === 'ar' ? 'الكل' : 'Toutes'} —</option>
                    {(categories ?? []).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="label text-[11px]">{settings.lang === 'ar' ? 'حالة المخزون' : 'Statut stock'}</label>
                  <Select
                    value={filterStockStatus}
                    onChange={(e) => setFilterStockStatus(e.target.value as any)}
                  >
                    <option value="all">{settings.lang === 'ar' ? 'كل المنتجات' : 'Tous les produits'}</option>
                    <option value="low">{settings.lang === 'ar' ? 'مخزون منخفض (أقل من الحد)' : 'Stock bas'}</option>
                    <option value="zero">{settings.lang === 'ar' ? 'مخزون منعدم (0)' : 'Stock zéro'}</option>
                    <option value="no_barcode">{settings.lang === 'ar' ? 'منتجات بدون باركود أصلي' : 'Sans code fabricant'}</option>
                    <option value="unknown">{settings.lang === 'ar' ? 'منتجات مجهولة (TMP)' : 'Produits inconnus (TMP)'}</option>
                  </Select>
                </div>
                <div>
                  <label className="label text-[11px]">{settings.lang === 'ar' ? 'المستودع' : 'Entrepôt'}</label>
                  <Select value={filterWh} onChange={(e) => setFilterWh(e.target.value)}>
                    <option value="">— {settings.lang === 'ar' ? 'الكل' : 'Tous'} —</option>
                    {(warehouses ?? []).map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="label text-[11px]">{settings.lang === 'ar' ? 'المنطقة' : 'Zone'}</label>
                  <Select value={filterZone} onChange={(e) => setFilterZone(e.target.value)}>
                    <option value="">— {settings.lang === 'ar' ? 'الكل' : 'Toutes'} —</option>
                    {(zones ?? []).map((z) => (
                      <option key={z} value={z}>
                        {z}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-line">
                <Btn
                  variant="primary"
                  className="!min-h-12 text-sm"
                  disabled={exportBusy}
                  onClick={() => handleExportMaster(false)}
                >
                  <Icon name="download" className="h-4 w-4" />
                  {settings.lang === 'ar' ? 'تصدير الكتالوج المفلتر (Master)' : 'Catalogue filtré (Master)'}
                </Btn>
                <Btn
                  className="!min-h-12 text-sm"
                  disabled={exportBusy}
                  onClick={handleExportDetailed}
                >
                  <Icon name="pin" className="h-4 w-4" />
                  {settings.lang === 'ar' ? 'تصدير تفاصيل المواقع (Detailed)' : 'Stock par emplacement'}
                </Btn>
              </div>
              {exportBusy && <Spinner label={t('loading')} />}
            </Card>
          </div>
        ) : (
          /* ----------------------------------------------------------------- */
          /* TAB 2: CSV IMPORT & UPDATE WORKFLOW                               */
          /* ----------------------------------------------------------------- */
          <div className="space-y-4">
            <Card className="space-y-3">
              <div className="flex items-start gap-3">
                <Icon name="upload" className="h-6 w-6 text-accent2 shrink-0 mt-1" />
                <div>
                  <p className="font-semibold">{settings.lang === 'ar' ? 'رفع ملف المنتجات' : 'Sélectionner un fichier'}</p>
                  <p className="text-xs text-white/50">
                    {settings.lang === 'ar'
                      ? 'يقبل ملفات CSV أو Excel (.xlsx) مع مطابقة ذكية لجميع الأعمدة والتحديث الآمن'
                      : 'Accepte les fichiers CSV ou Excel (.xlsx) avec détection automatique des colonnes'}
                  </p>
                </div>
              </div>

              <input
                ref={fileRef}
                type="file"
                accept=".csv,.tsv,.txt,.xlsx,.xls"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
              />

              <Btn
                variant="primary"
                className="w-full !min-h-12"
                onClick={() => fileRef.current?.click()}
                disabled={analyzing || importing}
              >
                <Icon name="upload" />
                {file ? file.name : settings.lang === 'ar' ? 'اختر ملف CSV / Excel…' : 'Choisir un fichier…'}
              </Btn>

              {importError && <p className="text-sm text-red-400">{importError}</p>}
            </Card>

            {analyzing && <Spinner label={settings.lang === 'ar' ? 'جارٍ تحليل الملف وفحص التكرارات…' : 'Analyse du fichier en cours…'} />}

            {/* PRE-IMPORT VALIDATION SUMMARY */}
            {analysis && (
              <>
                <Card className="space-y-3 border-accent2/30">
                  <p className="font-bold text-base">
                    {settings.lang === 'ar' ? 'تقرير فحص الملف قبل الاستيراد' : 'Résumé avant importation'}
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                    <div className="rounded-xl bg-panel2 p-2.5">
                      <div className="text-lg font-bold">{analysis.totalRows}</div>
                      <div className="text-white/50">{settings.lang === 'ar' ? 'إجمالي الأسطر' : 'Lignes totales'}</div>
                    </div>
                    <div className="rounded-xl bg-emerald-500/15 p-2.5 text-emerald-300">
                      <div className="text-lg font-bold">{analysis.newCount}</div>
                      <div>{settings.lang === 'ar' ? 'منتجات جديدة' : 'Nouveaux'}</div>
                    </div>
                    <div className="rounded-xl bg-accent2/15 p-2.5 text-accent2">
                      <div className="text-lg font-bold">{analysis.existingCount}</div>
                      <div>{settings.lang === 'ar' ? 'منتجات موجودة' : 'Existants'}</div>
                    </div>
                    <div
                      className={`rounded-xl p-2.5 ${
                        analysis.invalidCount > 0 ? 'bg-red-500/15 text-red-300' : 'bg-panel2 text-white/50'
                      }`}
                    >
                      <div className="text-lg font-bold">{analysis.invalidCount}</div>
                      <div>{settings.lang === 'ar' ? 'أسطر غير صالحة' : 'Lignes invalides'}</div>
                    </div>
                  </div>

                  {(analysis.duplicateRefCount > 0 || analysis.duplicateBarcodeCount > 0) && (
                    <div className="rounded-xl bg-amber-500/10 p-3 text-xs text-amber-200 space-y-1">
                      {analysis.duplicateRefCount > 0 && (
                        <p>⚠️ {settings.lang === 'ar' ? `تكرار في المراجع داخل الملف: ${analysis.duplicateRefCount}` : `Références en double: ${analysis.duplicateRefCount}`}</p>
                      )}
                      {analysis.duplicateBarcodeCount > 0 && (
                        <p>⚠️ {settings.lang === 'ar' ? `تكرار في الباركود داخل الملف: ${analysis.duplicateBarcodeCount}` : `Codes-barres en double: ${analysis.duplicateBarcodeCount}`}</p>
                      )}
                    </div>
                  )}

                  {/* Errors table and download error report button */}
                  {analysis.errors.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-line">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-red-400">
                          {settings.lang === 'ar'
                            ? `الأخطاء والمشاكل المكتشفة (${analysis.errors.length})`
                            : `Erreurs détectées (${analysis.errors.length})`}
                        </span>
                        <Btn
                          className="!min-h-7 !px-2 text-xs text-red-300"
                          onClick={() => downloadErrorReport(analysis.errors)}
                        >
                          <Icon name="download" className="h-3.5 w-3.5" />
                          {settings.lang === 'ar' ? 'تنزيل تقرير الأخطاء (CSV)' : 'Télécharger rapport d’erreurs'}
                        </Btn>
                      </div>

                      <div className="max-h-48 overflow-y-auto rounded-lg border border-line bg-black/40 p-2 text-[11px] space-y-1.5">
                        {analysis.errors.slice(0, 20).map((err, i) => (
                          <div key={i} className="border-b border-white/5 pb-1">
                            <span className="font-mono text-amber-300">#{err.rowNumber} [{err.reference}]: </span>
                            <span className="text-white/80">{err.problem}</span>
                            <span className="block text-white/40">💡 {err.suggestion}</span>
                          </div>
                        ))}
                        {analysis.errors.length > 20 && (
                          <p className="text-white/40 text-center">
                            +{analysis.errors.length - 20} {settings.lang === 'ar' ? 'أخطاء إضافية…' : 'autres erreurs…'}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </Card>

                {/* COLUMN MAPPING ACCORDION */}
                {mapping && (
                  <Card className="space-y-3">
                    <p className="font-semibold text-sm">
                      {settings.lang === 'ar' ? 'مطابقة أعمدة الملف (Column Mapping)' : 'Correspondance des colonnes'}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      {CSV_IMPORT_FIELDS.map((f) => (
                        <div key={f} className="flex items-center justify-between gap-2 border-b border-line/40 pb-1.5">
                          <span className="truncate">
                            {f === 'reference' ? 'Référence *' : f === 'name' ? 'Nom produit *' : f}
                          </span>
                          <select
                            value={mapping[f]}
                            onChange={(e) => {
                              const next = { ...mapping, [f]: Number(e.target.value) };
                              setMapping(next);
                              reanalyze(next);
                            }}
                            className="input !min-h-7 !w-36 !p-1 text-xs"
                          >
                            <option value={-1}>— {settings.lang === 'ar' ? 'غير مطابق' : 'Non mappé'} —</option>
                            {headers.map((h, i) => (
                              <option key={i} value={i}>
                                {h || `Col ${i + 1}`}
                              </option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {/* IMPORT MODE SELECTION */}
                <Card className="space-y-3">
                  <p className="font-semibold text-sm">
                    {settings.lang === 'ar' ? 'طريقة الاستيراد والتحديث' : 'Mode d’importation'}
                  </p>

                  <div className="space-y-2 text-xs">
                    <label className="flex items-start gap-2.5 p-2 rounded-xl border border-line bg-panel2 cursor-pointer">
                      <input
                        type="radio"
                        name="importMode"
                        value="update_existing"
                        checked={importMode === 'update_existing'}
                        onChange={() => setImportMode('update_existing')}
                        className="mt-0.5 accent-[#2f7bff]"
                      />
                      <div>
                        <span className="font-bold text-white block">
                          {settings.lang === 'ar' ? 'ب. تحديث المنتجات الموجودة وإضافة الجديدة' : 'B. Mettre à jour les existants et ajouter les nouveaux'}
                        </span>
                        <span className="text-white/50 text-[11px]">
                          {settings.lang === 'ar'
                            ? 'يحدث الأسماء والأوصاف والفئات مع حماية تامة للهويات والباركودات الدائمة'
                            : 'Met à jour les libellés tout en protégeant les identifiants et codes internes'}
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start gap-2.5 p-2 rounded-xl border border-line bg-panel2 cursor-pointer">
                      <input
                        type="radio"
                        name="importMode"
                        value="add_only"
                        checked={importMode === 'add_only'}
                        onChange={() => setImportMode('add_only')}
                        className="mt-0.5 accent-[#2f7bff]"
                      />
                      <div>
                        <span className="font-bold text-white block">
                          {settings.lang === 'ar' ? 'أ. إضافة المنتجات الجديدة فقط' : 'A. Ajouter uniquement les nouveaux'}
                        </span>
                        <span className="text-white/50 text-[11px]">
                          {settings.lang === 'ar'
                            ? 'يتجاهل المنتجات الموجودة مسبقًا بالكامل دون أي تعديل عليها'
                            : 'Ignore complètement les produits déjà enregistrés'}
                        </span>
                      </div>
                    </label>

                    <label className="flex items-start gap-2.5 p-2 rounded-xl border border-line bg-panel2 cursor-pointer">
                      <input
                        type="radio"
                        name="importMode"
                        value="opening_balance"
                        checked={importMode === 'opening_balance'}
                        onChange={() => setImportMode('opening_balance')}
                        className="mt-0.5 accent-[#2f7bff]"
                      />
                      <div>
                        <span className="font-bold text-white block">
                          {settings.lang === 'ar' ? 'ج. استيراد كرصيد افتتاحي للمخزون (Opening Balance)' : 'C. Importer comme solde de stock initial'}
                        </span>
                        <span className="text-white/50 text-[11px]">
                          {settings.lang === 'ar'
                            ? 'ينشئ حركة رصيد افتتاحي مدققة دون مسح التاريخ السابق للكميات'
                            : 'Génère un mouvement d’ouverture traçable sans écraser l’historique'}
                        </span>
                      </div>
                    </label>
                  </div>

                  {importMode === 'opening_balance' && (
                    <div className="space-y-2 p-3 rounded-xl bg-accent/10 border border-accent/20">
                      <p className="text-xs font-semibold text-accent2">
                        {settings.lang === 'ar' ? 'إعدادات جلسة الرصيد الافتتاحي:' : 'Paramètres de la session initiale:'}
                      </p>
                      <Input
                        value={openingSessionName}
                        onChange={(e) => setOpeningSessionName(e.target.value)}
                        placeholder={settings.lang === 'ar' ? 'اسم جلسة الرصيد (اختياري)' : 'Nom de la session (optionnel)'}
                        className="!min-h-9 text-xs"
                      />
                      <Input
                        value={warehouseName}
                        onChange={(e) => setWarehouseName(e.target.value)}
                        placeholder={settings.lang === 'ar' ? 'اسم المستودع (افتراضي: المستودع الرئيسي)' : 'Nom entrepôt'}
                        className="!min-h-9 text-xs"
                      />
                    </div>
                  )}

                  <Btn
                    variant="primary"
                    className="w-full !min-h-14 text-base font-bold"
                    disabled={importing || analysis.totalRows === 0}
                    onClick={handleExecuteImport}
                  >
                    <Icon name="check" className="h-5 w-5" />
                    {settings.lang === 'ar' ? 'تأكيد وتنفيذ الاستيراد' : 'Exécuter l’importation'}
                  </Btn>
                  {importing && <Spinner label={settings.lang === 'ar' ? 'جارٍ تنفيذ الاستيراد…' : 'Importation en cours…'} />}
                </Card>
              </>
            )}

            {/* IMPORT SUCCESS RESULT */}
            {importResult && (
              <Card className="space-y-3 border-emerald-500/40 bg-emerald-500/10">
                <p className="text-base font-bold text-emerald-300">
                  {settings.lang === 'ar' ? '✓ تم إكمال عملية الاستيراد بنجاح' : '✓ Importation terminée avec succès'}
                </p>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="bg-panel2 p-2 rounded-lg">
                    <span className="block text-base font-bold text-emerald-400">{importResult.created}</span>
                    <span className="text-white/50">{settings.lang === 'ar' ? 'جديد تم إنشاؤه' : 'Créés'}</span>
                  </div>
                  <div className="bg-panel2 p-2 rounded-lg">
                    <span className="block text-base font-bold text-accent2">{importResult.updated}</span>
                    <span className="text-white/50">{settings.lang === 'ar' ? 'تم تحديثه' : 'Mis à jour'}</span>
                  </div>
                  <div className="bg-panel2 p-2 rounded-lg">
                    <span className="block text-base font-bold text-white">{importResult.stockRecordsCreated}</span>
                    <span className="text-white/50">{settings.lang === 'ar' ? 'حركات مخزون' : 'Mouvements'}</span>
                  </div>
                </div>
              </Card>
            )}
          </div>
        )}
      </Page>
    </Shell>
  );
}

