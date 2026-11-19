import { describe, expect, it } from 'vitest';
import { addProduct, call, createTestEnv, pipe, wire } from './helpers';
import { currentStock, stockFromMovements } from '../src/lib/stock';
import { customerBalance } from '../src/lib/ledger';
import { sales } from '../src/db/schema';
import { eq } from 'drizzle-orm';

async function setup() {
  const env = await createTestEnv();
  const wireId = await addProduct(env.app, env.adminToken, wire, 900);
  const pipeId = await addProduct(env.app, env.adminToken, pipe, 650);
  const customerId = (await call(env.app, env.adminToken, 'POST', '/api/customers', { name: 'Rashid' })).body.id as number;
  const sell = (body: object) => call(env.app, env.cashierToken, 'POST', '/api/sales', body).then((r) => r.body);
  return { ...env, wireId, pipeId, customerId, sell };
}

describe('customer returns', () => {
  it('returns against one bill at the price paid (bill discount shared), restocks good items', async () => {
    const { app, cashierToken, wireId, sell } = await setup();
    const sale = await sell({ items: [{ productId: wireId, qty: 1, unit: 'coil', rate: 630000 }], billDiscount: 63000, paid: 567000 });
    const info = (await call(app, cashierToken, 'GET', `/api/returns/returnable?billNo=${sale.billNo.toLowerCase()}`)).body;
    expect(info.items[0]).toMatchObject({ sold: 90, returnable: 90, rate: 6300 });
    const ret = await call(app, cashierToken, 'POST', '/api/returns', { saleId: sale.id, items: [{ productId: wireId, qty: 10, condition: 'good' }], refundType: 'cash' });
    expect(ret.status).toBe(200);
    expect(ret.body.refund).toBe(63000);
    expect(currentStock(app.ctx.db, wireId)).toBe(900 - 90 + 10);
    const again = (await call(app, cashierToken, 'GET', `/api/returns/returnable?saleId=${sale.id}`)).body;
    expect(again.items[0].returnable).toBe(80);
    const tooMany = await call(app, cashierToken, 'POST', '/api/returns', { saleId: sale.id, items: [{ productId: wireId, qty: 81, condition: 'good' }], refundType: 'cash' });
    expect(tooMany.body.code).toBe('RETURN_TOO_MUCH');
  });

  it('damaged goods do not go back on the shelf but are recorded', async () => {
    const { app, cashierToken, wireId, sell } = await setup();
    const sale = await sell({ items: [{ productId: wireId, qty: 10, unit: 'metre', rate: 7000 }], paid: 70000 });
    await call(app, cashierToken, 'POST', '/api/returns', { saleId: sale.id, items: [{ productId: wireId, qty: 4, condition: 'damaged' }], refundType: 'cash' });
    expect(currentStock(app.ctx.db, wireId)).toBe(890);
    expect(stockFromMovements(app.ctx.db, wireId)).toBe(890);
  });

  it('returns across all bills of a customer to khata, minus restock charge', async () => {
    const { app, cashierToken, wireId, customerId, sell } = await setup();
    await sell({ customerId, items: [{ productId: wireId, qty: 5, unit: 'metre', rate: 7000 }], paid: 0 });
    await sell({ customerId, items: [{ productId: wireId, qty: 5, unit: 'metre', rate: 6800 }], paid: 0 });
    expect(customerBalance(app.ctx.db, customerId)).toBe(69000);
    const info = (await call(app, cashierToken, 'GET', `/api/returns/returnable?customerId=${customerId}`)).body;
    expect(info.items[0]).toMatchObject({ sold: 10, returnable: 10, rate: 6800 });
    const ret = await call(app, cashierToken, 'POST', '/api/returns', {
      customerId,
      items: [{ productId: wireId, qty: 8, condition: 'good' }],
      refundType: 'khata',
      restockCharge: 4400,
    });
    expect(ret.body.refund).toBe(54400 - 4400);
    expect(ret.body.customerBalance).toBe(69000 - 50000);
  });

  it('needs a customer for khata refunds and refuses cancelled bills', async () => {
    const { app, adminToken, cashierToken, wireId, sell } = await setup();
    const sale = await sell({ items: [{ productId: wireId, qty: 5, unit: 'metre', rate: 7000 }], paid: 35000 });
    const khata = await call(app, cashierToken, 'POST', '/api/returns', { saleId: sale.id, items: [{ productId: wireId, qty: 1, condition: 'good' }], refundType: 'khata' });
    expect(khata.body.code).toBe('CUSTOMER_REQUIRED');
    await call(app, adminToken, 'POST', `/api/sales/${sale.id}/cancel`, { reason: 'test' });
    const cancelled = await call(app, cashierToken, 'POST', '/api/returns', { saleId: sale.id, items: [{ productId: wireId, qty: 1, condition: 'good' }], refundType: 'cash' });
    expect(cancelled.body.code).toBe('BILL_NOT_DONE');
  });

  it('reduces plumber commission in proportion', async () => {
    const { app, adminToken, cashierToken, wireId, sell } = await setup();
    const plumber = (await call(app, adminToken, 'POST', '/api/plumbers', { name: 'Akram', commissionPct: 10 })).body;
    const sale = await sell({ plumberId: plumber.id, items: [{ productId: wireId, qty: 10, unit: 'metre', rate: 7000 }], paid: 70000 });
    expect(sale.commission).toBe(7000);
    await call(app, cashierToken, 'POST', '/api/returns', { saleId: sale.id, items: [{ productId: wireId, qty: 4, condition: 'good' }], refundType: 'cash' });
    const after = app.ctx.db.select().from(sales).where(eq(sales.id, sale.id)).get()!;
    expect(after.commission).toBe(4200);
  });

  it('exchange: return value pays part of a new bill, only once', async () => {
    const { app, cashierToken, wireId, pipeId, sell } = await setup();
    const sale = await sell({ items: [{ productId: wireId, qty: 10, unit: 'metre', rate: 7000 }], paid: 70000 });
    const ret = (await call(app, cashierToken, 'POST', '/api/returns', { saleId: sale.id, items: [{ productId: wireId, qty: 10, condition: 'good' }], refundType: 'exchange' })).body;
    const tooSmall = await call(app, cashierToken, 'POST', '/api/sales', { exchangeReturnId: ret.id, items: [{ productId: pipeId, qty: 1, unit: 'foot', rate: 4000 }], paid: 0 });
    expect(tooSmall.body.code).toBe('CREDIT_TOO_BIG');
    const swap = await call(app, cashierToken, 'POST', '/api/sales', { exchangeReturnId: ret.id, items: [{ productId: pipeId, qty: 2, unit: 'length', rate: 52000 }], paid: 34000 });
    expect(swap.status).toBe(200);
    expect(swap.body).toMatchObject({ total: 104000, creditApplied: 70000, paid: 34000, due: 0 });
    const twice = await call(app, cashierToken, 'POST', '/api/sales', { exchangeReturnId: ret.id, items: [{ productId: pipeId, qty: 2, unit: 'length', rate: 52000 }], paid: 34000 });
    expect(twice.body.code).toBe('EXCHANGE_USED');
  });
});

describe('site challans', () => {
  it('goes out, gets more, comes back, and ends in one bill minus the advance', async () => {
    const { app, cashierToken, wireId, pipeId, customerId } = await setup();
    const { db } = app.ctx;
    let ch = (
      await call(app, cashierToken, 'POST', '/api/challans', {
        customerId,
        siteName: 'DHA House 12',
        advance: 100000,
        items: [{ productId: wireId, qty: 180, rate: 7000 }],
      })
    ).body;
    expect(ch.challanNo).toBe('CH-00001');
    expect(currentStock(db, wireId)).toBe(720);
    ch = (await call(app, cashierToken, 'POST', `/api/challans/${ch.id}/items`, { items: [{ productId: wireId, qty: 20, rate: 7000 }, { productId: pipeId, qty: 26, rate: 4000 }] })).body;
    expect(ch.items.find((i: { productId: number }) => i.productId === wireId).qtyOut).toBe(200);
    ch = (await call(app, cashierToken, 'POST', `/api/challans/${ch.id}/return`, { items: [{ productId: wireId, qty: 50 }] })).body;
    expect(currentStock(db, wireId)).toBe(750);
    const over = await call(app, cashierToken, 'POST', `/api/challans/${ch.id}/return`, { items: [{ productId: pipeId, qty: 27 }] });
    expect(over.body.code).toBe('RETURN_TOO_MUCH');
    expect(customerBalance(db, customerId)).toBe(-100000);

    ch = (await call(app, cashierToken, 'POST', `/api/challans/${ch.id}/close`, { paid: 50000 })).body;
    expect(ch.status).toBe('closed');
    const bill = (await call(app, cashierToken, 'GET', `/api/sales/${ch.finalSaleId}`)).body;
    expect(bill.total).toBe(150 * 7000 + 26 * 4000);
    expect(bill.creditApplied).toBe(100000);
    expect(bill.due).toBe(bill.total - 100000 - 50000);
    expect(customerBalance(db, customerId)).toBe(bill.due);
    expect(currentStock(db, wireId)).toBe(750);
    expect(stockFromMovements(db, pipeId)).toBe(650 - 26);
    expect((await call(app, cashierToken, 'POST', `/api/challans/${ch.id}/items`, { items: [{ productId: wireId, qty: 1, rate: 1 }] })).body.code).toBe('CHALLAN_CLOSED');
  });
});
