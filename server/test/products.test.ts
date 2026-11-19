import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { call, createTestEnv, pipe } from './helpers';
import { currentStock, stockFromMovements } from '../src/lib/stock';
import { matchScore, normalizeSearch, searchProducts } from '../src/shared/search';
import { importProducts } from '../src/modules/products/excel';
import { adjustPrice } from '../src/modules/products/service';
import { toBaseQty, stockLevel } from '../src/shared/units';

describe('search', () => {
  const tap = { code: 'T-9', barcode: '8964000123', nameEn: 'Tonti Steel', nameUr: 'ٹونٹی', aliases: 'tap faucet', brand: 'Sonex', size: '' };

  it('forgives Roman Urdu spelling', () => {
    expect(normalizeSearch('Tooti')).toBe(normalizeSearch('tuti'));
    expect(normalizeSearch('Pankha')).toBe(normalizeSearch('panka'));
    expect(matchScore(tap, 'toonti')).toBeGreaterThan(0);
    expect(matchScore(tap, 'ٹونٹی')).toBeGreaterThan(0);
    expect(matchScore(tap, 'faucet sonex')).toBeGreaterThan(0);
    expect(matchScore(tap, 'wire')).toBe(0);
  });

  it('ranks exact barcode and code first', () => {
    expect(matchScore(tap, '8964000123')).toBe(100);
    expect(matchScore(tap, 't-9')).toBe(90);
    const other = { ...tap, code: 'X', barcode: null, nameEn: 'Steel T-9 bracket' };
    expect(searchProducts([other, tap], 'T-9')[0]).toBe(tap);
  });
});

describe('units', () => {
  it('converts packs to base units and grades stock', () => {
    expect(toBaseQty(2, 90)).toBe(180);
    expect(toBaseQty(0.5, 13)).toBe(6.5);
    expect(stockLevel(0, 5)).toBe('out');
    expect(stockLevel(5, 5)).toBe('low');
    expect(stockLevel(6, 5)).toBe('ok');
  });

  it('rounds brand price updates to whole rupees', () => {
    expect(adjustPrice(4000, 10)).toBe(4400);
    expect(adjustPrice(3333, 5)).toBe(3500);
  });
});

describe('products and stock', () => {
  it('creates a product with opening stock that equals the movement sum', async () => {
    const { app, adminToken } = await createTestEnv();
    const res = await call(app, adminToken, 'POST', '/api/products', { ...pipe, openingStock: 650 });
    expect(res.status).toBe(200);
    const { db } = app.ctx;
    expect(currentStock(db, res.body.id)).toBe(650);
    expect(stockFromMovements(db, res.body.id)).toBe(650);
  });

  it('rejects duplicate codes and barcodes', async () => {
    const { app, adminToken } = await createTestEnv();
    await call(app, adminToken, 'POST', '/api/products', { ...pipe, barcode: '111' });
    expect((await call(app, adminToken, 'POST', '/api/products', pipe)).body.code).toBe('CODE_TAKEN');
    expect((await call(app, adminToken, 'POST', '/api/products', { ...pipe, code: 'P-2', barcode: '111' })).body.code).toBe('BARCODE_TAKEN');
  });

  it('hides cost price from cashiers and blocks cashier edits', async () => {
    const { app, adminToken, cashierToken } = await createTestEnv();
    await call(app, adminToken, 'POST', '/api/products', pipe);
    const asCashier = await call(app, cashierToken, 'GET', '/api/products');
    expect(asCashier.body[0].costPrice).toBeUndefined();
    expect(asCashier.body[0].retailPrice).toBe(4000);
    const asAdmin = await call(app, adminToken, 'GET', '/api/products');
    expect(asAdmin.body[0].costPrice).toBe(3000);
    expect((await call(app, cashierToken, 'POST', '/api/products', { ...pipe, code: 'Z' })).status).toBe(403);
    expect((await call(app, cashierToken, 'POST', '/api/stock/damage', { productId: 1, qty: 1 })).status).toBe(403);
  });

  it('records damage and stock count as movements', async () => {
    const { app, adminToken } = await createTestEnv();
    const p = (await call(app, adminToken, 'POST', '/api/products', { ...pipe, openingStock: 100 })).body;
    expect((await call(app, adminToken, 'POST', '/api/stock/damage', { productId: p.id, qty: 4 })).body.stock).toBe(96);
    expect((await call(app, adminToken, 'POST', '/api/stock/damage', { productId: p.id, qty: 500 })).body.code).toBe('NOT_ENOUGH_STOCK');
    await call(app, adminToken, 'POST', '/api/stock/count', { items: [{ productId: p.id, countedQty: 90.5 }] });
    const { db } = app.ctx;
    expect(currentStock(db, p.id)).toBe(90.5);
    expect(stockFromMovements(db, p.id)).toBe(90.5);
    const moves = (await call(app, adminToken, 'GET', `/api/products/${p.id}/movements`)).body;
    expect(moves.map((m: { type: string }) => m.type)).toEqual(['adjust', 'damage', 'opening']);
  });

  it('updates prices by brand percentage', async () => {
    const { app, adminToken } = await createTestEnv();
    await call(app, adminToken, 'POST', '/api/products', { ...pipe, brand: 'Beta' });
    const res = await call(app, adminToken, 'POST', '/api/products/price-update', { brand: 'beta', pct: 10, fields: ['retailPrice'] });
    expect(res.body.updated).toBe(1);
    const list = (await call(app, adminToken, 'GET', '/api/products')).body;
    expect(list[0].retailPrice).toBe(4400);
    expect(list[0].plumberPrice).toBe(3700);
  });
});

describe('excel import', () => {
  it('creates new rows, updates existing codes and reports bad rows', async () => {
    const { app, adminToken } = await createTestEnv();
    await call(app, adminToken, 'POST', '/api/products', pipe);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('P');
    ws.addRow(['code', 'name_en', 'category', 'retail_price', 'stock', 'unit']);
    ws.addRow(['P-1', 'PVC Pipe half inch', 'Pipes', 45, 999, 'foot']);
    ws.addRow(['W-1', 'Wire 1.5mm', 'Wires', '70', 900, 'metre']);
    ws.addRow(['W-2', 'Wire 2.5mm', 'Wires', 'abc', 10, 'metre']);
    ws.addRow([]);
    const { db, sqlite } = app.ctx;
    const result = importProducts(db, sqlite, ws, { userId: 1, deviceId: 1 });
    expect(result.created).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].row).toBe(4);
    const list = (await call(app, adminToken, 'GET', '/api/products')).body as { code: string; retailPrice: number; stock: number; categoryName: string; costPrice: number }[];
    const p1 = list.find((p) => p.code === 'P-1')!;
    expect(p1.retailPrice).toBe(4500);
    expect(p1.costPrice).toBe(3000);
    expect(p1.stock).toBe(0);
    const w1 = list.find((p) => p.code === 'W-1')!;
    expect(w1.stock).toBe(900);
    expect(w1.categoryName).toBe('Wires');
  });
});
