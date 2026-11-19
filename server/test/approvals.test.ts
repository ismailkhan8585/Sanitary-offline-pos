import { describe, expect, it } from 'vitest';
import { addProduct, call, createTestEnv, wire } from './helpers';
import { approvals, sales } from '../src/db/schema';

async function setup() {
  const env = await createTestEnv();
  const wireId = await addProduct(env.app, env.adminToken, wire, 20);
  return { ...env, wireId };
}

const line = (productId: number, qty = 1, rate = 7000) => ({ productId, qty, unit: 'metre', rate });

describe('admin PIN approvals for cashiers', () => {
  it('asks for approval with the reasons, then accepts a right Admin PIN and records it', async () => {
    const { app, cashierToken, wireId } = await setup();
    const body = { items: [line(wireId, 10)], billDiscount: 10000, paid: 60000 };
    const asked = await call(app, cashierToken, 'POST', '/api/sales', body);
    expect(asked.status).toBe(403);
    expect(asked.body.code).toBe('APPROVAL_REQUIRED');
    expect(asked.body.params.reasons).toEqual(['discount_limit']);
    const wrong = await call(app, cashierToken, 'POST', '/api/sales', { ...body, adminPin: '9999' });
    expect(wrong.body.code).toBe('WRONG_ADMIN_PIN');
    expect(app.ctx.db.select().from(sales).all()).toHaveLength(0);
    const ok = await call(app, cashierToken, 'POST', '/api/sales', { ...body, adminPin: '1234' });
    expect(ok.status).toBe(200);
    const saved = app.ctx.db.select().from(approvals).all();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ action: 'discount_limit', approvedBy: 1 });
  });

  it('flags below cost, selling more than stock and a changed rate', async () => {
    const { app, cashierToken, wireId } = await setup();
    const res = await call(app, cashierToken, 'POST', '/api/sales', { items: [line(wireId, 25, 5000)], paid: 125000 });
    expect(res.body.params.reasons.sort()).toEqual(['below_cost', 'rate_change', 'zero_stock']);
  });

  it('flags going over a customer credit limit', async () => {
    const { app, adminToken, cashierToken, wireId } = await setup();
    const c = (await call(app, adminToken, 'POST', '/api/customers', { name: 'Small Shop', creditLimit: 50000, openingBalance: 40000 })).body;
    const res = await call(app, cashierToken, 'POST', '/api/sales', { customerId: c.id, items: [line(wireId, 2)], paid: 0 });
    expect(res.body.params.reasons).toEqual(['credit_limit']);
  });

  it('lets Admin do all of it without a PIN, and quotations need nothing', async () => {
    const { app, adminToken, cashierToken, wireId } = await setup();
    expect((await call(app, adminToken, 'POST', '/api/sales', { items: [line(wireId, 25, 5000)], paid: 125000 })).status).toBe(200);
    expect((await call(app, cashierToken, 'POST', '/api/sales', { status: 'quotation', items: [line(wireId, 99, 1)] })).status).toBe(200);
  });

  it('applies the return limit', async () => {
    const { app, adminToken, cashierToken, cashierId, wireId } = await setup();
    await call(app, adminToken, 'PUT', `/api/users/${cashierId}`, { returnLimit: 100000 });
    const sale = (await call(app, cashierToken, 'POST', '/api/sales', { items: [line(wireId, 20)], paid: 140000 })).body;
    const body = { saleId: sale.id, items: [{ productId: wireId, qty: 20, condition: 'good' }], refundType: 'cash' };
    expect((await call(app, cashierToken, 'POST', '/api/returns', body)).body.params.reasons).toEqual(['return_limit']);
    expect((await call(app, cashierToken, 'POST', '/api/returns', { ...body, adminPin: '1234' })).status).toBe(200);
  });
});

describe('expenses', () => {
  it('checks the expense limit and shows cashiers only their own', async () => {
    const { app, adminToken, cashierToken } = await setup();
    expect((await call(app, cashierToken, 'POST', '/api/expenses', { category: 'Tea / food', amount: 50000, method: 'cash' })).status).toBe(200);
    const big = await call(app, cashierToken, 'POST', '/api/expenses', { category: 'Repair', amount: 500000, method: 'cash' });
    expect(big.body.code).toBe('APPROVAL_REQUIRED');
    await call(app, adminToken, 'POST', '/api/expenses', { category: 'Rent', amount: 5000000, method: 'bank' });
    expect((await call(app, cashierToken, 'GET', '/api/expenses')).body).toHaveLength(1);
    expect((await call(app, adminToken, 'GET', '/api/expenses')).body).toHaveLength(2);
  });
});

describe('shifts', () => {
  it('expects opening + cash in − cash out, and records the difference', async () => {
    const { app, adminToken, cashierToken, wireId } = await setup();
    expect((await call(app, cashierToken, 'POST', '/api/shifts/close', { closingCash: 0 })).body.code).toBe('NO_SHIFT');
    await call(app, cashierToken, 'POST', '/api/shifts/open', { openingCash: 500000 });
    expect((await call(app, cashierToken, 'POST', '/api/shifts/open', { openingCash: 1 })).body.code).toBe('SHIFT_OPEN');
    const c = (await call(app, adminToken, 'POST', '/api/customers', { name: 'Rashid' })).body;
    await call(app, cashierToken, 'POST', '/api/sales', { items: [line(wireId, 10)], paid: 70000 });
    await call(app, cashierToken, 'POST', '/api/sales', { customerId: c.id, items: [line(wireId, 2)], paymentMethod: 'card', paid: 14000 });
    await call(app, cashierToken, 'POST', '/api/payments', { partyType: 'customer', partyId: c.id, amount: 20000, method: 'cash', direction: 'in' });
    await call(app, cashierToken, 'POST', '/api/expenses', { category: 'Tea / food', amount: 3000, method: 'cash' });
    await call(app, adminToken, 'POST', '/api/sales', { items: [line(wireId, 1)], paid: 7000 });
    const current = (await call(app, cashierToken, 'GET', '/api/shifts/current')).body;
    expect(current.summary).toMatchObject({ salesCount: 2, cashSales: 70000, paymentsIn: 20000, expenses: 3000 });
    expect(current.summary.byMethod.card).toBe(14000);
    const expected = 500000 + 70000 + 20000 - 3000;
    expect(current.summary.expected).toBe(expected);
    const closed = (await call(app, cashierToken, 'POST', '/api/shifts/close', { closingCash: expected - 1000 })).body;
    expect(closed).toMatchObject({ expectedCash: expected, difference: -1000 });
    expect((await call(app, cashierToken, 'GET', '/api/shifts')).body).toHaveLength(1);
  });

  it('cashiers cannot open other people’s shifts', async () => {
    const { app, adminToken, cashierToken } = await setup();
    const s = (await call(app, adminToken, 'POST', '/api/shifts/open', { openingCash: 0 })).body;
    expect((await call(app, cashierToken, 'GET', `/api/shifts/${s.id}`)).status).toBe(403);
    expect((await call(app, cashierToken, 'GET', '/api/shifts')).body).toHaveLength(0);
  });
});

describe('activity log', () => {
  it('records important actions and is Admin only', async () => {
    const { app, adminToken, cashierToken, wireId } = await setup();
    await call(app, cashierToken, 'POST', '/api/sales', { items: [line(wireId, 1)], paid: 7000 });
    const log = (await call(app, adminToken, 'GET', '/api/activity?action=sale')).body;
    expect(log[0]).toMatchObject({ action: 'sale.done', userName: 'Ali', deviceName: 'Counter A' });
    expect((await call(app, cashierToken, 'GET', '/api/activity')).status).toBe(403);
  });
});
