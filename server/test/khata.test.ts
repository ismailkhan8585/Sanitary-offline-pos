import { describe, expect, it } from 'vitest';
import { addProduct, call, createTestEnv, wire } from './helpers';
import { allBalances, customerBalance } from '../src/lib/ledger';

async function setup() {
  const env = await createTestEnv();
  const wireId = await addProduct(env.app, env.adminToken, wire, 900);
  const customer = (await call(env.app, env.adminToken, 'POST', '/api/customers', { name: 'Rashid', openingBalance: 100000, creditLimit: 1000000 })).body;
  return { ...env, wireId, customerId: customer.id as number };
}

describe('customer khata', () => {
  it('runs opening + udhaar bills − payments, and the ledger ends on the balance', async () => {
    const { app, adminToken, cashierToken, wireId, customerId } = await setup();
    await call(app, cashierToken, 'POST', '/api/sales', { customerId, items: [{ productId: wireId, qty: 10, unit: 'metre', rate: 7000 }], paid: 20000 });
    let res = await call(app, cashierToken, 'POST', '/api/payments', { partyType: 'customer', partyId: customerId, amount: 30000, method: 'cash', direction: 'in' });
    expect(res.status).toBe(200);
    expect(res.body.balance).toBe(100000 + 50000 - 30000);
    res = await call(app, adminToken, 'POST', '/api/payments', { partyType: 'customer', partyId: customerId, amount: 5000, method: 'cash', direction: 'out', note: 'refund' });
    expect(res.body.balance).toBe(125000);
    const ledger = (await call(app, cashierToken, 'GET', `/api/customers/${customerId}/ledger`)).body;
    expect(ledger.party.balance).toBe(125000);
    const entries = ledger.entries as { kind: string; balance: number; debit: number; credit: number }[];
    expect(entries.map((e) => e.kind)).toEqual(['opening', 'sale', 'payment_in', 'payment_out']);
    expect(entries.at(-1)!.balance).toBe(125000);
    expect(entries[1]).toMatchObject({ debit: 70000, credit: 20000, balance: 150000 });
  });

  it('cancelled bills do not count', async () => {
    const { app, adminToken, cashierToken, wireId, customerId } = await setup();
    const sale = await call(app, cashierToken, 'POST', '/api/sales', { customerId, items: [{ productId: wireId, qty: 10, unit: 'metre', rate: 7000 }], paid: 0 });
    expect(customerBalance(app.ctx.db, customerId)).toBe(170000);
    await call(app, adminToken, 'POST', `/api/sales/${sale.body.id}/cancel`, { reason: 'mistake' });
    expect(customerBalance(app.ctx.db, customerId)).toBe(100000);
  });

  it('lists every customer with its balance (bulk = single)', async () => {
    const { app, cashierToken, customerId } = await setup();
    const list = (await call(app, cashierToken, 'GET', '/api/customers')).body;
    expect(list[0].balance).toBe(100000);
    expect(allBalances(app.ctx.db, 'customer').get(customerId)).toBe(customerBalance(app.ctx.db, customerId));
  });

  it('cashiers cannot set credit limit or opening balance', async () => {
    const { app, cashierToken } = await setup();
    const created = (await call(app, cashierToken, 'POST', '/api/customers', { name: 'New', creditLimit: 999999, openingBalance: 50000 })).body;
    expect(created.creditLimit).toBe(0);
    expect(created.openingBalance).toBe(0);
    const updated = (await call(app, cashierToken, 'PUT', `/api/customers/${created.id}`, { creditLimit: 5, phone: '0300' })).body;
    expect(updated.creditLimit).toBe(0);
    expect(updated.phone).toBe('0300');
  });
});

describe('payments permissions', () => {
  it('cashier may receive from customers only', async () => {
    const { app, adminToken, cashierToken, customerId } = await setup();
    const supplier = (await call(app, adminToken, 'POST', '/api/suppliers', { name: 'Beta Pipes', openingBalance: 500000 })).body;
    expect((await call(app, cashierToken, 'POST', '/api/payments', { partyType: 'supplier', partyId: supplier.id, amount: 100, method: 'cash', direction: 'out' })).status).toBe(403);
    expect((await call(app, cashierToken, 'POST', '/api/payments', { partyType: 'customer', partyId: customerId, amount: 100, method: 'cash', direction: 'out' })).status).toBe(403);
    expect((await call(app, cashierToken, 'GET', '/api/suppliers')).status).toBe(403);
    expect((await call(app, cashierToken, 'POST', '/api/payments', { partyType: 'customer', partyId: 999, amount: 100, method: 'cash', direction: 'in' })).status).toBe(404);
    expect((await call(app, cashierToken, 'POST', '/api/payments', { partyType: 'customer', partyId: customerId, amount: 100, method: 'credit', direction: 'in' })).status).toBe(400);
  });
});

describe('supplier and plumber khata', () => {
  it('supplier: opening − payments out', async () => {
    const { app, adminToken } = await setup();
    const s = (await call(app, adminToken, 'POST', '/api/suppliers', { name: 'Beta Pipes', openingBalance: 500000 })).body;
    const res = await call(app, adminToken, 'POST', '/api/payments', { partyType: 'supplier', partyId: s.id, amount: 200000, method: 'bank', direction: 'out' });
    expect(res.body.balance).toBe(300000);
    const ledger = (await call(app, adminToken, 'GET', `/api/suppliers/${s.id}/ledger`)).body;
    expect(ledger.entries.at(-1).balance).toBe(300000);
  });

  it('plumber: commission earned − payouts; cashiers do not see balances', async () => {
    const { app, adminToken, cashierToken, wireId } = await setup();
    const p = (await call(app, adminToken, 'POST', '/api/plumbers', { name: 'Akram', commissionPct: 10 })).body;
    await call(app, cashierToken, 'POST', '/api/sales', { plumberId: p.id, items: [{ productId: wireId, qty: 10, unit: 'metre', rate: 7000 }], paid: 70000 });
    expect((await call(app, adminToken, 'GET', '/api/plumbers')).body[0].balance).toBe(7000);
    expect((await call(app, cashierToken, 'GET', '/api/plumbers')).body[0].balance).toBeUndefined();
    const res = await call(app, adminToken, 'POST', '/api/payments', { partyType: 'plumber', partyId: p.id, amount: 5000, method: 'cash', direction: 'out' });
    expect(res.body.balance).toBe(2000);
    const ledger = (await call(app, adminToken, 'GET', `/api/plumbers/${p.id}/ledger`)).body;
    expect(ledger.entries.map((e: { kind: string }) => e.kind)).toEqual(['opening', 'commission', 'payment_out']);
  });
});
