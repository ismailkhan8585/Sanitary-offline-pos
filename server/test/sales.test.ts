import { describe, expect, it } from 'vitest';
import { addProduct, call, createTestEnv, pipe, wire } from './helpers';
import { billTotals, commissionFor, discountPercent } from '../src/shared/billing';
import { currentStock, stockFromMovements } from '../src/lib/stock';
import { sales } from '../src/db/schema';

describe('bill arithmetic', () => {
  it('applies line discount, bill discount and tax', () => {
    const t = billTotals(
      [
        { qty: 2, rate: 4000, discount: 0 },
        { qty: 1.5, rate: 7000, discount: 500 },
      ],
      1000,
      10,
    );
    expect(t.gross).toBe(18500);
    expect(t.subtotal).toBe(18000);
    expect(t.discount).toBe(1000);
    expect(t.tax).toBe(1700);
    expect(t.total).toBe(18700);
    expect(discountPercent(t)).toBeCloseTo((1500 / 18500) * 100);
    expect(commissionFor(t, 5)).toBe(850);
  });

  it('never discounts below zero', () => {
    expect(billTotals([{ qty: 1, rate: 1000, discount: 0 }], 5000, 0).total).toBe(0);
  });
});

describe('sales', () => {
  async function setup() {
    const env = await createTestEnv();
    const pipeId = await addProduct(env.app, env.adminToken, pipe, 650);
    const wireId = await addProduct(env.app, env.adminToken, wire, 900);
    return { ...env, pipeId, wireId };
  }

  it('saves a cash bill, numbers it per counter and reduces stock in base units', async () => {
    const { app, cashierToken, pipeId, wireId } = await setup();
    const res = await call(app, cashierToken, 'POST', '/api/sales', {
      items: [
        { productId: pipeId, qty: 2, unit: 'length', rate: 52000 },
        { productId: wireId, qty: 15, unit: 'metre', rate: 7000 },
      ],
      paymentMethod: 'cash',
      paid: 999999,
    });
    expect(res.status).toBe(200);
    expect(res.body.billNo).toBe('A-00001');
    expect(res.body.total).toBe(104000 + 105000);
    expect(res.body.paid).toBe(res.body.total);
    expect(res.body.due).toBe(0);
    expect(res.body.items[0].cost).toBeUndefined();
    const { db } = app.ctx;
    expect(currentStock(db, pipeId)).toBe(650 - 26);
    expect(currentStock(db, wireId)).toBe(900 - 15);
    expect(stockFromMovements(db, pipeId)).toBe(currentStock(db, pipeId));
    const second = await call(app, cashierToken, 'POST', '/api/sales', { items: [{ productId: wireId, qty: 1, unit: 'coil', rate: 630000 }], paid: 630000 });
    expect(second.body.billNo).toBe('A-00002');
    expect(currentStock(db, wireId)).toBe(900 - 15 - 90);
  });

  it('uses the bill letter of the counter that made the sale', async () => {
    const { app, adminToken, cashierId, wireId } = await setup();
    const dev = await call(app, adminToken, 'POST', '/api/devices', { name: 'Counter B', billPrefix: 'B' });
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { userId: cashierId, pin: '1111', deviceId: dev.body.id } });
    const token = res.json().token;
    const sale = await call(app, token, 'POST', '/api/sales', { items: [{ productId: wireId, qty: 1, unit: 'metre', rate: 7000 }], paid: 7000 });
    expect(sale.body.billNo).toBe('B-00001');
  });

  it('rejects a unit the product is not sold in', async () => {
    const { app, cashierToken, wireId } = await setup();
    const res = await call(app, cashierToken, 'POST', '/api/sales', { items: [{ productId: wireId, qty: 1, unit: 'box', rate: 1 }] });
    expect(res.body.code).toBe('BAD_UNIT');
  });

  it('requires a customer for udhaar and records the due', async () => {
    const { app, cashierToken, wireId } = await setup();
    const noCustomer = await call(app, cashierToken, 'POST', '/api/sales', {
      items: [{ productId: wireId, qty: 10, unit: 'metre', rate: 7000 }],
      paymentMethod: 'credit',
      paid: 20000,
    });
    expect(noCustomer.body.code).toBe('CUSTOMER_REQUIRED');
    const customer = await call(app, cashierToken, 'POST', '/api/customers', { name: 'Rashid Contractor', openingBalance: 0 });
    const sale = await call(app, cashierToken, 'POST', '/api/sales', {
      customerId: customer.body.id,
      items: [{ productId: wireId, qty: 10, unit: 'metre', rate: 7000 }],
      paymentMethod: 'cash',
      paid: 20000,
    });
    expect(sale.body.due).toBe(50000);
    expect(sale.body.customerBalance).toBe(50000);
    const full = await call(app, cashierToken, 'POST', '/api/sales', {
      customerId: customer.body.id,
      items: [{ productId: wireId, qty: 1, unit: 'metre', rate: 7000 }],
      paymentMethod: 'cash',
      paid: 0,
    });
    expect(full.body.paymentMethod).toBe('credit');
    expect(full.body.customerBalance).toBe(57000);
  });

  it('computes plumber commission', async () => {
    const { app, adminToken, cashierToken, wireId } = await setup();
    const plumber = await call(app, adminToken, 'POST', '/api/plumbers', { name: 'Ustad Akram', commissionPct: 5 });
    const sale = await call(app, cashierToken, 'POST', '/api/sales', {
      plumberId: plumber.body.id,
      priceTier: 'plumber',
      items: [{ productId: wireId, qty: 10, unit: 'metre', rate: 6600 }],
      paid: 66000,
    });
    expect(sale.body.commission).toBe(3300);
  });

  it('holds a bill without touching stock, then recalls it', async () => {
    const { app, cashierToken, wireId } = await setup();
    const held = await call(app, cashierToken, 'POST', '/api/sales', { status: 'held', items: [{ productId: wireId, qty: 5, unit: 'metre', rate: 7000 }] });
    expect(held.body.billNo).toBe('HA-00001');
    expect(currentStock(app.ctx.db, wireId)).toBe(900);
    const open = await call(app, cashierToken, 'GET', '/api/sales/open');
    expect(open.body).toHaveLength(1);
    const done = await call(app, cashierToken, 'POST', '/api/sales', {
      fromHeldId: held.body.id,
      items: [{ productId: wireId, qty: 5, unit: 'metre', rate: 7000 }],
      paid: 35000,
    });
    expect(done.body.billNo).toBe('A-00001');
    expect(currentStock(app.ctx.db, wireId)).toBe(895);
    expect((await call(app, cashierToken, 'GET', '/api/sales/open')).body).toHaveLength(0);
    const quote = await call(app, cashierToken, 'POST', '/api/sales', { status: 'quotation', items: [{ productId: wireId, qty: 5, unit: 'metre', rate: 7000 }] });
    expect(quote.body.billNo).toBe('QA-00001');
  });

  it('lets only Admin cancel, and puts stock back', async () => {
    const { app, adminToken, cashierToken, wireId } = await setup();
    const sale = await call(app, cashierToken, 'POST', '/api/sales', { items: [{ productId: wireId, qty: 1, unit: 'coil', rate: 630000 }], paid: 630000 });
    expect((await call(app, cashierToken, 'POST', `/api/sales/${sale.body.id}/cancel`, { reason: 'wrong item' })).status).toBe(403);
    const cancelled = await call(app, adminToken, 'POST', `/api/sales/${sale.body.id}/cancel`, { reason: 'wrong item' });
    expect(cancelled.body.status).toBe('cancelled');
    expect(currentStock(app.ctx.db, wireId)).toBe(900);
    expect(stockFromMovements(app.ctx.db, wireId)).toBe(900);
    expect((await call(app, adminToken, 'POST', `/api/sales/${sale.body.id}/cancel`, { reason: 'again' })).body.code).toBe('ALREADY_CANCELLED');
  });

  it('writes nothing when any line fails (one transaction)', async () => {
    const { app, cashierToken, wireId } = await setup();
    const res = await call(app, cashierToken, 'POST', '/api/sales', {
      items: [
        { productId: wireId, qty: 10, unit: 'metre', rate: 7000 },
        { productId: 9999, qty: 1, unit: 'piece', rate: 100 },
      ],
      paid: 70100,
    });
    expect(res.status).toBe(404);
    expect(currentStock(app.ctx.db, wireId)).toBe(900);
    expect(app.ctx.db.select().from(sales).all()).toHaveLength(0);
  });

  it('refuses sales from a device that is not a counter', async () => {
    const { app, cashierId, wireId } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { userId: cashierId, pin: '1111', deviceId: null } });
    const token = res.json().token;
    const sale = await call(app, token, 'POST', '/api/sales', { items: [{ productId: wireId, qty: 1, unit: 'metre', rate: 7000 }], paid: 7000 });
    expect(sale.body.code).toBe('NO_COUNTER');
  });
});
