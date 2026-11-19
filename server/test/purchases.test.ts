import { describe, expect, it } from 'vitest';
import { addProduct, call, createTestEnv, wire } from './helpers';
import { currentStock, stockFromMovements } from '../src/lib/stock';
import { effectiveUnitCost } from '../src/modules/purchases';
import { purchases } from '../src/db/schema';

async function setup() {
  const env = await createTestEnv();
  const wireId = await addProduct(env.app, env.adminToken, wire, 90);
  const supplier = (await call(env.app, env.adminToken, 'POST', '/api/suppliers', { name: 'Pakistan Cables', openingBalance: 0 })).body;
  return { ...env, wireId, supplierId: supplier.id as number };
}

describe('purchases', () => {
  it('spreads bonus units over the cost', () => {
    expect(effectiveUnitCost(6000, 10, 2)).toBe(5000);
    expect(effectiveUnitCost(6000, 10, 0)).toBe(6000);
  });

  it('adds paid + free stock in base units, updates cost and supplier balance', async () => {
    const { app, adminToken, wireId, supplierId } = await setup();
    const res = await call(app, adminToken, 'POST', '/api/purchases', {
      supplierId,
      invoiceNo: 'INV-77',
      items: [{ productId: wireId, unit: 'coil', qty: 10, freeQty: 1, cost: 540000 }],
      paid: 2000000,
      paymentMethod: 'bank',
    });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(5400000);
    expect(res.body.due).toBe(3400000);
    expect(res.body.supplierBalance).toBe(3400000);
    const { db } = app.ctx;
    expect(currentStock(db, wireId)).toBe(90 + 990);
    expect(stockFromMovements(db, wireId)).toBe(1080);
    const product = (await call(app, adminToken, 'GET', '/api/products')).body[0];
    expect(product.costPrice).toBe(Math.round((6000 * 900) / 990));
  });

  it('keeps the old cost when asked', async () => {
    const { app, adminToken, wireId, supplierId } = await setup();
    await call(app, adminToken, 'POST', '/api/purchases', { supplierId, items: [{ productId: wireId, unit: 'metre', qty: 10, cost: 9999 }], updateCost: false });
    expect((await call(app, adminToken, 'GET', '/api/products')).body[0].costPrice).toBe(5500);
  });

  it('returns goods to the supplier: stock down, payable down', async () => {
    const { app, adminToken, wireId, supplierId } = await setup();
    await call(app, adminToken, 'POST', '/api/purchases', { supplierId, items: [{ productId: wireId, unit: 'metre', qty: 100, cost: 5500 }] });
    const ret = await call(app, adminToken, 'POST', '/api/purchases', {
      supplierId,
      isReturn: true,
      items: [{ productId: wireId, unit: 'metre', qty: 20, cost: 5500 }],
      paid: 10000,
    });
    expect(ret.status).toBe(200);
    expect(ret.body.supplierBalance).toBe(550000 - 110000 + 10000);
    expect(currentStock(app.ctx.db, wireId)).toBe(170);
    const ledger = (await call(app, adminToken, 'GET', `/api/suppliers/${supplierId}/ledger`)).body;
    expect(ledger.entries.at(-1).balance).toBe(ret.body.supplierBalance);
    const tooMany = await call(app, adminToken, 'POST', '/api/purchases', { supplierId, isReturn: true, items: [{ productId: wireId, unit: 'metre', qty: 5000, cost: 1 }] });
    expect(tooMany.body.code).toBe('NOT_ENOUGH_STOCK');
    expect(app.ctx.db.select().from(purchases).all()).toHaveLength(2);
  });

  it('is Admin only and rejects overpayment', async () => {
    const { app, adminToken, cashierToken, wireId, supplierId } = await setup();
    const body = { supplierId, items: [{ productId: wireId, unit: 'metre', qty: 1, cost: 5500 }] };
    expect((await call(app, cashierToken, 'POST', '/api/purchases', body)).status).toBe(403);
    expect((await call(app, adminToken, 'POST', '/api/purchases', { ...body, paid: 6000 })).body.code).toBe('PAID_TOO_MUCH');
  });
});
