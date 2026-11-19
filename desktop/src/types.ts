/** A bill made on this counter while the server was down. Money in paisa. */
export interface EmergencyBill {
  billNo: string;
  createdAt: number;
  userId: number | null;
  userName: string;
  items: { productId: number; code: string; name: string; qty: number; unit: string; rate: number; total: number }[];
  subtotal: number;
  billDiscount: number;
  total: number;
  paid: number;
  change: number;
}

/** What the counter keeps from the server so it can bill alone. */
export interface Catalog {
  savedAt: number;
  shop: { shop_name_en: string; shop_name_ur: string; shop_address: string; shop_phone: string; receipt_footer_en: string; receipt_footer_ur: string; receipt_width: '58' | '80' | 'a4' };
  device: { id: number; name: string; billPrefix: string };
  user: { id: number; name: string };
  /** Highest emergency number the server already has for this counter. */
  lastEmergencyNo: number;
  products: { id: number; code: string; barcode: string | null; nameEn: string; nameUr: string; aliases: string; unit: string; retailPrice: number }[];
}

export interface DesktopConfig {
  serverUrl: string;
  printerName: string;
}
