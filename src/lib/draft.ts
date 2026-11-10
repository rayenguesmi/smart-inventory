/** Short-lived hand-over between screens (OCR / photo → product form). */
export interface ProductDraft {
  reference?: string;
  barcode?: string;
  name?: string;
  description?: string;
  photoIds?: string[];
  unknown?: boolean;
  ocrNote?: string;
}

const KEY = 'si.draft';

export function setDraft(d: ProductDraft) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* ignore */
  }
}

/** Non-destructive read (React StrictMode renders twice in dev); call clearDraft() after saving. */
export function readDraft(): ProductDraft | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ProductDraft) : null;
  } catch {
    return null;
  }
}

export function clearDraft() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
