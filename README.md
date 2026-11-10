# SMART INVENTORY — Mobile stocktaking PWA

Fast physical inventory counting with the phone camera: barcode scanning (ZXing), label OCR (Tesseract.js),
photo capture, quick quantity entry, Excel/CSV export and JSON backup. Arabic (default, RTL) and French.
Local-first: everything is stored in IndexedDB (Dexie) on the device and works offline after the first load.

## Stack
React 18 + TypeScript · Vite · Tailwind CSS 3 · Dexie (IndexedDB) · vite-plugin-pwa (service worker) ·
@zxing/browser · tesseract.js · xlsx · jszip

## Run locally
```bash
npm install
npm run dev          # http://localhost:5173  (camera needs HTTPS or localhost)
npm run typecheck    # tsc --noEmit
npm run build        # production build -> dist/
npm run preview      # serve dist/ to test the PWA / offline mode
```
Node 18+ (Netlify uses Node 20 via `netlify.toml`).

## Deploy on Netlify
1. Push this folder to a GitHub repository.
2. Netlify → *Add new site* → *Import from Git* → pick the repo.
3. Settings are read from `netlify.toml` (build `npm run build`, publish `dist`). Click *Deploy*.
4. Open the HTTPS URL on Android Chrome → menu → *Install app* (or use *Settings → Install* inside the app).

Camera access requires HTTPS, which Netlify provides.

## Important limitations (version 1)
- **Data lives only in the browser of the phone that created it.** There is no sync between phones.
  Clearing browser data or uninstalling can erase it. Use **More → Backup** (JSON, optionally with photos) regularly,
  and restore it on another device if needed. The app warns about this on the home screen and the backup page.
- **OCR** downloads its language model (a few MB) from a CDN the first time it is used, then caches it for offline use.
  OCR results are shown as editable suggestions with a confidence hint; the app never invents a reference.
- **Photo → product recognition is not available**: no AI service is configured. Products are named manually.
  No data is sent to any external service.
- Future backend sync is not implemented; the data model (UUID ids, timestamps, append-only counting records)
  was designed to make adding it possible.

## Workflow
Home → select session → select Emplacement → **Scan** → confirm quantity → back to scanner automatically
(continuous mode, cooldown against double scans, undo-last, recent products list).

- Products have a permanent internal id; barcode and reference are unique identification keys.
- Re-scanning adds another counting record; totals are summed per product, per location and per unit
  (cartons and pieces are never silently mixed).
- Counting records are never overwritten or silently deleted: corrections void the old record and create a linked new one.
- Unknown products get unique `TMP-0001…` references (atomic counter) and appear in the Unknown list to be identified later.
- Duplicate products can be merged after confirmation; history is preserved.

## Features by screen
Home dashboard · Sessions · Locations (zones/shelves, bulk add, mark done) · Scanner · OCR · Photo ·
Product form · Quantity entry · Products · Unknown products · History (filters, correct/void) ·
Reports (xlsx/csv: full, inventory, by location, unknown, product database, photos ZIP) ·
Import (CSV/xlsx with column mapping) · Backup/Restore (validated, confirmed) · Settings (language, scanning, demo data, self-test).

## Testing
*Settings → Self-test* runs the full workflow (session, location, product creation, unknown product with TMP ref,
repeated scans, per-location accumulation, undo, correction, merge, Excel export build, backup serialisation + validation) against a separate throw-away database
and reports pass/fail without touching your data. *Settings → Demo data* loads clearly marked DEMO products and a
demo session, removable at any time.

Manual checks worth doing on a real phone after deploying: JSON restore, close/reopen persistence, camera permission flow, scanning real barcodes,
installing the PWA, enabling airplane mode and reopening the app, exporting an .xlsx.

## Project layout
```
src/
  db.ts, types.ts, i18n.ts, context.tsx, router.ts
  components/  Shell, Scanner, QuantitySheet, LocationPicker, FilterBar, PhotoButton, ui
  pages/       Home, Sessions, Locations, Scan, Capture (OCR/photo), ProductForm, QuantityPage,
               Products, ProductDetail, Unknown, History, Reports, Import, Backup, Settings, More
  lib/         products, records, locations, backup, importer, reports, ocr, image, io, filters, demo, selftest, ...
```
