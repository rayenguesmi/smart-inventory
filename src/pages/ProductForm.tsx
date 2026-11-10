import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useApp } from '../context';
import { Shell, Page } from '../components/Shell';
import PhotoButton from '../components/PhotoButton';
import { Badge, Btn, Card, Field, Icon, Input, Select, TextArea, Thumb } from '../components/ui';
import { AppError, createProduct, isTmpRef, updateProduct, type ProductInput } from '../lib/products';
import { addRecord } from '../lib/records';
import { savePhoto } from '../lib/image';
import { clearDraft, readDraft } from '../lib/draft';
import { useLocations } from '../lib/hooks';
import { locName } from '../lib/locations';
import { DECIMAL_UNITS, UNITS, type Unit } from '../types';
import { go, goBack, useRoute } from '../router';

/** Screens 7 (product identification) and the edit form. Also the "unknown product" screen. */
export default function ProductForm({ id }: { id?: string }) {
  const { t, unitLabel, settings, sessionId, locationId, toast } = useApp();
  const { query } = useRoute();
  const editing = !!id;
  const existing = useLiveQuery(() => (id ? db.products.get(id) : undefined), [id]);
  const draft = useMemo(() => (query.draft ? readDraft() : null), []); // eslint-disable-line react-hooks/exhaustive-deps
  const unknownMode = !editing && (query.unknown === '1' || !!draft?.unknown);
  const locs = useLocations(sessionId);

  const [f, setF] = useState({
    reference: draft?.reference ?? query.ref ?? '',
    barcode: draft?.barcode ?? query.barcode ?? '',
    name: draft?.name ?? '',
    description: draft?.description ?? '',
    category: '',
    unit: 'piece' as Unit,
    cartonQty: '',
    minStock: '',
    qty: '',
    countUnit: 'piece' as Unit,
    locId: locationId ?? '',
  });
  const [photoIds, setPhotoIds] = useState<string[]>(draft?.photoIds ?? []);
  const [loaded, setLoaded] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const [dupId, setDupId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (editing && existing && !loaded) {
    setLoaded(true);
    setF((s) => ({
      ...s,
      reference: existing.reference ?? '',
      barcode: existing.originalBarcode ?? existing.barcode ?? '',
      name: existing.name,
      description: existing.description ?? '',
      category: existing.category ?? '',
      unit: existing.unit,
      cartonQty: existing.cartonQty ? String(existing.cartonQty) : '',
      minStock: existing.minStock != null ? String(existing.minStock) : '',
    }));
    setPhotoIds(existing.photoIds);
  }

  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const decimalCount = DECIMAL_UNITS.includes(f.countUnit);
  const willBeTemp = !editing && !f.reference.trim() && !f.barcode.trim();

  const addPhoto = async (file: File) => {
    try {
      const pid = await savePhoto(file);
      setPhotoIds((l) => [...l, pid]);
    } catch {
      toast(t('err.photo'), 'err');
    }
  };

  const save = async () => {
    const e: Record<string, string> = {};
    setDupId(null);
    const cq = f.cartonQty.trim() ? Number(f.cartonQty) : null;
    if (cq !== null && (!Number.isInteger(cq) || cq < 1)) e.cartonQty = t('err.BAD_CARTON');
    const minStk = f.minStock.trim() ? Number(f.minStock) : null;
    if (minStk !== null && (!Number.isFinite(minStk) || minStk < 0)) e.minStock = t('err.BAD_QTY');
    const qtyNum = f.qty.trim() === '' ? null : Number(f.qty);
    if (qtyNum !== null && (!Number.isFinite(qtyNum) || qtyNum < 0 || (!decimalCount && !Number.isInteger(qtyNum)))) e.qty = t('err.BAD_QTY');
    if (qtyNum !== null && (!sessionId || !f.locId)) e.locId = t('scan.needLocation');
    if (!editing && !f.name.trim() && !f.reference.trim() && !f.barcode.trim() && photoIds.length === 0) e.name = t('form.needSomething');
    setErr(e);
    if (Object.keys(e).length) return;

    const input: ProductInput = {
      reference: f.reference,
      barcode: f.barcode,
      originalBarcode: f.barcode,
      name: f.name,
      description: f.description,
      category: f.category,
      unit: f.unit,
      cartonQty: cq,
      minStock: minStk,
      photoIds,
    };
    setSaving(true);
    try {
      if (editing && id) {
        await updateProduct(id, input);
        toast(t('saved'));
        goBack('/p/' + id);
        return;
      }
      const p = await createProduct(input);
      clearDraft();
      if (qtyNum !== null && sessionId && f.locId) {
        await addRecord({ sessionId, locationId: f.locId, productId: p.id, qty: qtyNum, unit: f.countUnit });
        toast(`✓ ${p.name}${p.isTemp ? ' (' + p.reference + ')' : ''}`);
        go('/scan', true);
      } else if (sessionId && locationId) {
        toast(t('form.created', { ref: p.reference ?? p.barcode ?? '' }));
        go('/quantity/' + p.id, true);
      } else {
        go('/p/' + p.id, true);
      }
    } catch (ex) {
      setSaving(false);
      if (ex instanceof AppError) {
        const field = ex.code === 'DUP_BARCODE' || ex.code === 'BAD_BARCODE' ? 'barcode' : ex.code === 'BAD_CARTON' ? 'cartonQty' : 'reference';
        setErr({ [field]: t('err.' + ex.code) });
        if (ex.existingId) setDupId(ex.existingId);
      } else {
        toast(t('err.generic'), 'err');
      }
    }
  };

  if (editing && !existing) return <Shell title={t('product.edit')} back noNav><Page><p className="text-white/50">{t('loading')}</p></Page></Shell>;

  const isTempExisting = editing && existing?.isTemp;

  return (
    <Shell title={editing ? t('product.edit') : unknownMode ? t('form.unknownTitle') : t('form.newTitle')} back noNav>
      <Page className="pb-32">
        {unknownMode && <Card className="text-sm text-white/60">{t('form.unknownHelp')}</Card>}
        {draft?.ocrNote && <Card className="text-sm text-amber-200">{t('ocr.verify')}</Card>}

        <div>
          <p className="label">{t('form.photos')}</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {photoIds.map((pid) => (
              <div key={pid} className="relative">
                <Thumb photoId={pid} className="h-24 w-24" />
                <button type="button" onClick={() => setPhotoIds((l) => l.filter((x) => x !== pid))} className="absolute -end-1 -top-1 flex h-8 w-8 items-center justify-center rounded-full bg-red-600" aria-label={t('delete')}>
                  <Icon name="x" className="h-4 w-4" />
                </button>
              </div>
            ))}
            <PhotoButton onFile={addPhoto} multiple className="flex h-24 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-line text-xs text-white/60">
              <Icon name="camera" className="h-7 w-7" /> {t('form.addPhoto')}
            </PhotoButton>
          </div>
        </div>

        <Field label={t('ref')} error={err.reference} hint={willBeTemp ? t('form.tmpAuto') : isTempExisting ? t('form.tmpAssign') : undefined}>
          <Input value={f.reference} onChange={(e) => set('reference', e.target.value)} placeholder={unknownMode ? 'TMP-????' : ''} autoCapitalize="characters" />
        </Field>
        {dupId && (
          <Btn className="w-full" onClick={() => go('/p/' + dupId)}>
            {t('form.openExisting')}
          </Btn>
        )}
        {editing && existing?.internalBarcode && (
          <div className="rounded-xl border border-line bg-panel2 p-3 text-xs">
            <span className="text-white/50">{settings.lang === 'ar' ? 'الباركود الداخلي الدائم (Code 128):' : 'Code-barres interne permanent:'}</span>
            <span className="ms-2 font-mono font-bold text-accent2">{existing.internalBarcode}</span>
          </div>
        )}
        <Field label={settings.lang === 'ar' ? 'باركود المصنّع الأصلي' : 'Code-barres fabricant'} error={err.barcode} hint={editing ? (settings.lang === 'ar' ? 'تعديل هذا الحقل لن يؤثر على الباركود الداخلي' : 'Ne modifie pas le code interne') : undefined}>
          <Input value={f.barcode} onChange={(e) => set('barcode', e.target.value)} inputMode="text" placeholder={editing ? '' : (settings.lang === 'ar' ? 'اتركه فارغًا لتوليد باركود تلقائي' : 'Laisser vide pour génération automatique')} />
        </Field>
        <Field label={t('product')} error={err.name}>
          <Input value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label={t('description')}>
          <TextArea value={f.description} onChange={(e) => set('description', e.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('category')}>
            <Input value={f.category} onChange={(e) => set('category', e.target.value)} />
          </Field>
          <Field label={settings.lang === 'ar' ? 'تنبيه الحد الأدنى للمخزون' : 'Alerte stock minimum'} error={err.minStock}>
            <Input inputMode="numeric" value={f.minStock} onChange={(e) => set('minStock', e.target.value)} placeholder="0" />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('form.defaultUnit')}>
            <Select value={f.unit} onChange={(e) => set('unit', e.target.value)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {unitLabel(u)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('form.cartonQty')} error={err.cartonQty} hint={t('form.cartonHint')}>
            <Input inputMode="numeric" value={f.cartonQty} onChange={(e) => set('cartonQty', e.target.value.replace(/\D/g, ''))} placeholder="20" />
          </Field>
        </div>

        {!editing && (
          <Card className="space-y-3">
            <p className="font-semibold">{t('form.countNow')}</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('qty')} error={err.qty}>
                <Input inputMode="decimal" value={f.qty} onChange={(e) => set('qty', e.target.value.replace(',', '.'))} placeholder="—" />
              </Field>
              <Field label={t('unit')}>
                <Select value={f.countUnit} onChange={(e) => set('countUnit', e.target.value)}>
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {unitLabel(u)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label={t('location')} error={err.locId}>
              <Select value={f.locId} onChange={(e) => set('locId', e.target.value)}>
                <option value="">—</option>
                {(locs ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {locName(l)}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-xs text-white/40">{t('form.countNowHint')}</p>
          </Card>
        )}
        {isTempExisting && isTmpRef(existing?.reference) && <Badge tone="warn">{t('unknown.temp')}</Badge>}
      </Page>

      <div className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-panel/95 p-3 backdrop-blur">
        <div className="mx-auto max-w-xl">
          <Btn variant="primary" className="w-full !min-h-16 text-lg" onClick={save} disabled={saving}>
            <Icon name="check" /> {editing ? t('save') : f.qty.trim() ? t('form.saveAndCount') : t('save')}
          </Btn>
        </div>
      </div>
    </Shell>
  );
}
