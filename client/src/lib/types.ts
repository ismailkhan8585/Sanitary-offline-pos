import type { PriceTier } from './pricing';

export interface Category {
  id: number;
  nameEn: string;
  nameUr: string;
}

export interface Product {
  id: number;
  code: string;
  barcode: string | null;
  nameEn: string;
  nameUr: string;
  aliases: string;
  categoryId: number | null;
  categoryName: string | null;
  brand: string;
  size: string;
  color: string;
  unit: string;
  packUnit: string | null;
  packQty: number;
  /** Missing for users who may not see cost. */
  costPrice?: number;
  retailPrice: number;
  plumberPrice: number;
  wholesalePrice: number;
  minStock: number;
  active: boolean;
  updatedAt: number;
  stock: number;
}

export type { PriceTier };

export type PaymentMethod = 'cash' | 'card' | 'jazzcash' | 'easypaisa' | 'bank' | 'credit';
export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'card', 'jazzcash', 'easypaisa', 'bank', 'credit'];
export type SaleStatus = 'done' | 'cancelled' | 'quotation' | 'held';

export interface SaleItem {
  id: number;
  productId: number;
  code: string;
  nameEn: string;
  nameUr: string;
  qty: number;
  unit: string;
  packQty: number;
  rate: number;
  cost?: number;
  discount: number;
  total: number;
}

export interface SaleDetail {
  id: number;
  billNo: string;
  deviceId: number | null;
  userId: number;
  customerId: number | null;
  plumberId: number | null;
  priceTier: PriceTier;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paid: number;
  due: number;
  creditApplied: number;
  paymentMethod: PaymentMethod;
  commission: number;
  status: SaleStatus;
  cancelReason: string | null;
  createdAt: number;
  customerName: string | null;
  customerPhone: string | null;
  plumberName: string | null;
  userName: string | null;
  deviceName: string | null;
  customerBalance: number | null;
  items: SaleItem[];
}

export interface Customer {
  id: number;
  name: string;
  phone: string;
  address: string;
  creditLimit: number;
  priceTier: PriceTier;
  openingBalance: number;
  createdAt: number;
  balance?: number;
}

export interface Plumber {
  id: number;
  name: string;
  phone: string;
  commissionPct: number;
}
