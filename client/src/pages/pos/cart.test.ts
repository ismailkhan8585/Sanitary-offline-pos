import { describe, expect, it } from 'vitest';
import type { Product } from '@/lib/types';
import { cartReducer, cartTotals, emptyCart, qtyInCart, toSaleItems } from './cart';

const wire: Product = {
  id: 1, code: 'W-1', barcode: null, nameEn: 'Wire 1.5mm', nameUr: 'تار', aliases: '', categoryId: null, categoryName: null,
  brand: '', size: '', color: '', unit: 'metre', packUnit: 'coil', packQty: 90, costPrice: 5500,
  retailPrice: 7000, plumberPrice: 6600, wholesalePrice: 0, minStock: 90, active: true, updatedAt: 0, stock: 900,
};

describe('cart', () => {
  it('adds a product, merges repeats and highlights the last line', () => {
    let c = cartReducer(emptyCart, { type: 'add', product: wire });
    c = cartReducer(c, { type: 'add', product: wire });
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0].qty).toBe(2);
    expect(c.lastKey).toBe(c.lines[0].key);
  });

  it('converts pack units and keeps a separate line per unit', () => {
    let c = cartReducer(emptyCart, { type: 'add', product: wire, unit: 'coil' });
    expect(c.lines[0].rate).toBe(630000);
    c = cartReducer(c, { type: 'add', product: wire, qty: 10 });
    expect(c.lines).toHaveLength(2);
    expect(qtyInCart(c, 1)).toBe(100);
  });

  it('reprices on tier change but keeps typed rates; wholesale 0 falls back to retail', () => {
    let c = cartReducer(emptyCart, { type: 'add', product: wire });
    c = cartReducer(c, { type: 'setTier', tier: 'plumber' });
    expect(c.lines[0].rate).toBe(6600);
    c = cartReducer(c, { type: 'setTier', tier: 'wholesale' });
    expect(c.lines[0].rate).toBe(7000);
    const key = c.lines[0].key;
    c = cartReducer(c, { type: 'update', key, unit: 'metre', qty: 3, rate: 6000, discount: 0 });
    c = cartReducer(c, { type: 'setTier', tier: 'plumber' });
    expect(c.lines[0].rate).toBe(6000);
    expect(c.lines[0].manualRate).toBe(true);
  });

  it('a unit switch at list price is not a typed rate; a different rate is', () => {
    let c = cartReducer(emptyCart, { type: 'add', product: wire });
    const key = c.lines[0].key;
    c = cartReducer(c, { type: 'update', key, unit: 'coil', qty: 1, rate: 630000, discount: 0 });
    expect(c.lines[0].manualRate).toBe(false);
    c = cartReducer(c, { type: 'update', key, unit: 'coil', qty: 1, rate: 600000, discount: 0 });
    expect(c.lines[0].manualRate).toBe(true);
  });

  it('removes and restores a line at the same place (undo)', () => {
    let c = cartReducer(emptyCart, { type: 'add', product: wire });
    c = cartReducer(c, { type: 'add', product: { ...wire, id: 2, code: 'X' } });
    const line = c.lines[0];
    c = cartReducer(c, { type: 'remove', key: line.key });
    expect(c.lines).toHaveLength(1);
    c = cartReducer(c, { type: 'restore', line, index: 0 });
    expect(c.lines[0].key).toBe(line.key);
  });

  it('totals and sale items match the server format', () => {
    let c = cartReducer(emptyCart, { type: 'add', product: wire, qty: 10 });
    c = cartReducer(c, { type: 'setBillDiscount', amount: 1000 });
    expect(cartTotals(c, 0).total).toBe(69000);
    expect(toSaleItems(c)).toEqual([{ productId: 1, qty: 10, unit: 'metre', rate: 7000, discount: 0 }]);
  });
});
