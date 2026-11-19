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
