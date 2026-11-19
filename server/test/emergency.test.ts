import { describe, expect, it } from 'vitest';
import { addProduct, call, createTestEnv, wire } from './helpers';
import { currentStock } from '../src/lib/stock';

describe('emergency bill upload', () => {
  it('saves offline bills with their own numbers, once', async () => {
    const { app, cashierToken, cashierId, adminToken } = await createTestEnv();
    const wireId = await addProduct(app, adminToken, wire, 100);
    const bill = (n: number) => ({
      billNo: `E-A-0000${n}`,
      createdAt: Date.now() - 3_600_000,
      userId: cashierId,
      items: [{ productId: wireId, qty: 10, unit: 'metre', rate: 7000 }],
      paid: 70000,
    });
    const first = await call(app, cashierToken, 'POST', '/api/emergency/upload', { bills: [bill(1), bill(2)] });
    expect(first.body).toMatchObject({ uploaded: ['E-A-00001', 'E-A-00002'], skipped: [], failed: [] });
    const again = await call(app, cashierToken, 'POST', '/api/emergency/upload', { bills: [bill(2), bill(3)] });
    expect(again.body).toMatchObject({ uploaded: ['E-A-00003'], skipped: ['E-A-00002'] });
    expect(currentStock(app.ctx.db, wireId)).toBe(70);
    const list = (await call(app, adminToken, 'GET', '/api/sales?q=E-A')).body;
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({ userName: 'Ali', total: 70000, status: 'done' });
    expect((await call(app, cashierToken, 'GET', '/api/emergency/last')).body.last).toBe(3);
    // Normal numbering is untouched.
    const normal = await call(app, cashierToken, 'POST', '/api/sales', { items: [{ productId: wireId, qty: 1, unit: 'metre', rate: 7000 }], paid: 7000 });
    expect(normal.body.billNo).toBe('A-00001');
  });

  it('reports a bad bill without losing the others', async () => {
    const { app, cashierToken, adminToken } = await createTestEnv();
    const wireId = await addProduct(app, adminToken, wire, 100);
    const res = await call(app, cashierToken, 'POST', '/api/emergency/upload', {
      bills: [
        { billNo: 'E-A-00001', createdAt: Date.now(), items: [{ productId: 999, qty: 1, unit: 'piece', rate: 1 }], paid: 1 },
        { billNo: 'E-A-00002', createdAt: Date.now(), items: [{ productId: wireId, qty: 1, unit: 'metre', rate: 7000 }], paid: 7000 },
      ],
    });
    expect(res.body.uploaded).toEqual(['E-A-00002']);
    expect(res.body.failed[0].billNo).toBe('E-A-00001');
  });
});
