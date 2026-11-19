/** Units a product is counted in (stock is always kept in the base unit). */
export const BASE_UNITS = ['piece', 'metre', 'foot', 'kg', 'litre', 'set', 'pair', 'roll'] as const;
/** Bigger units sold as a pack of the base unit, e.g. 1 coil = 90 metre, 1 box = 10 piece. */
export const PACK_UNITS = ['box', 'coil', 'length', 'dozen', 'packet', 'carton', 'bundle'] as const;

/** Quantity in base units for `qty` of a unit holding `packQty` base units. */
export function toBaseQty(qty: number, packQty: number): number {
  return Math.round(qty * packQty * 1000) / 1000;
}

export type StockLevel = 'out' | 'low' | 'ok';

export function stockLevel(qty: number, minStock: number): StockLevel {
  if (qty <= 0) return 'out';
  if (qty <= minStock) return 'low';
  return 'ok';
}
