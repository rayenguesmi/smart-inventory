export type Lang = 'ar' | 'fr';
export type Unit = 'piece' | 'box' | 'carton' | 'kg' | 'meter';
export const UNITS: Unit[] = ['piece', 'box', 'carton', 'kg', 'meter'];
export const DECIMAL_UNITS: Unit[] = ['kg', 'meter'];

export type BarcodeType = 'original' | 'internal' | 'secondary' | 'custom';
export type BarcodeStatus = 'active' | 'retired';

export interface BarcodeItem {
  code: string;
  type: BarcodeType;
  createdAt: number;
  status: BarcodeStatus;
}

export interface Product {
  id: string;
  reference?: string;
  /** upper-cased reference, unique index */
  refKey?: string;
  barcode?: string;
  /** original manufacturer barcode */
  originalBarcode?: string;
  /** permanent internal generated Code 128 barcode (e.g. INV-000001) */
  internalBarcode?: string;
  /** all registered barcodes for this product */
  barcodes?: BarcodeItem[];
  /** minimum stock alert threshold */
  minStock?: number;
  name: string;
  description?: string;
  category?: string;
  photoIds: string[];
  unit: Unit;
  /** pieces per carton, when configured */
  cartonQty?: number;
  /** true while the product only has an automatic TMP-0001 style reference */
  isTemp: boolean;
  /** other codes (old TMP refs, merged products' codes) that resolve to this product */
  aliases: string[];
  /** set when this product was merged into another one (record kept for history) */
  mergedInto?: string;
  demo?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  id: string;
  name: string;
  date: string;
  warehouse: string;
  notes?: string;
  status: 'active' | 'paused' | 'closed';
  demo?: boolean;
  createdAt: number;
}

export interface Loc {
  id: string;
  sessionId: string;
  zone: string;
  /** empty string = the zone itself */
  shelf: string;
  completed: boolean;
  demo?: boolean;
  createdAt: number;
}

export type MovementType = 'count' | 'in' | 'out' | 'opening' | 'adjustment';

export type StockOutReason =
  | 'customer_delivery'
  | 'internal_consumption'
  | 'transfer_warehouse'
  | 'damaged_products'
  | 'return_supplier'
  | 'other';

export type StockOutStatus = 'draft' | 'confirmed' | 'reversed';

export interface StockOutLine {
  id: string;
  productId: string;
  name: string;
  reference?: string;
  barcode?: string;
  warehouse: string;
  locationId?: string;
  zone?: string;
  shelf?: string;
  availableStock: number;
  quantity: number;
  unit: Unit;
  photoId?: string;
}

export interface StockOutDocument {
  id: string;
  docNo: string;
  date: string;
  dateTime: number;
  recipient: string;
  deliveryRef?: string;
  reason: StockOutReason;
  customReason?: string;
  warehouse: string;
  locationId?: string;
  zone?: string;
  shelf?: string;
  notes?: string;
  status: StockOutStatus;
  lines: StockOutLine[];
  totalLines: number;
  totalQuantity: number;
  confirmedAt?: number;
  confirmedBy?: string;
  reversedAt?: number;
  reversedBy?: string;
  reversalReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CountRecord {
  id: string;
  sessionId: string;
  locationId: string;
  productId: string;
  qty: number;
  unit: Unit;
  createdAt: number;
  /** stock movement type: count, stock in, stock out, opening balance, or adjustment */
  type?: MovementType;
  note?: string;
  /** linked document information if generated from Stock OUT or other operations */
  docId?: string;
  docNo?: string;
  reason?: string;
  recipient?: string;
  operator?: string;
  /** set when voided (undo / void). The record itself is never deleted */
  voidedAt?: number;
  /** correction chain */
  supersedes?: string;
  supersededBy?: string;
  /** product this record belonged to before a merge */
  fromProductId?: string;
  demo?: boolean;
}

export interface PhotoRow {
  id: string;
  blob: Blob;
  createdAt: number;
  demo?: boolean;
}

export interface MetaRow {
  key: string;
  value: any;
}

export interface Settings {
  lang: Lang;
  continuous: boolean;
  cooldownMs: number;
  beep: boolean;
  vibrate: boolean;
}
