import { describe, expect, it } from 'vitest';
import { addProduct, call, createTestEnv, pipe, wire } from './helpers';

async function setup() {
  const env = await createTestEnv();
  const cat = (await call(env.app, env.adminToken, 'POST', '/api/categories', { nameEn: 'Wires' })).body;
  const wireId = await addProduct(env.app, env.adminToken, { ...wire, categoryId: cat.id, brand: 'PC' }, 900);
  const pipeId = await addProduct(env.app, env.adminToken, pipe, 650);
  const customer = (await call(env.app, env.adminToken, 'POST', '/api/customers', { name: 'Rashid' })).body;
  // 10 m wire: total 70,000, cost 55,000 → profit 15,000. Udhaar 30,000.
  const sale = (await call(env.app, env.adminToken, 'POST', '/api/sales', { customerId: customer.id, items: [{ productId: wireId, qty: 10, unit: 'metre', rate: 7000 }], paid: 40000 })).body;
  return { ...env, wireId, pipeId, sale, customerId: customer.id as number };
}

describe('reports', () => {
  it('daily sales with returns and profit', async () => {
    const { app, adminToken, wireId, sale } = await setup();
    await call(app, adminToken, 'POST', '/api/returns', { saleId: sale.id, items: [{ productId: wireId, qty: 2, condition: 'good' }], refundType: 'cash' });
    const r = (await call(app, adminToken, 'GET', '/api/reports/sales')).body;
    expect(r.columns.map((c: { key: string }) => c.key)).toContain('profit');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ bills: 1, total: 70000, returns: 14000, net: 56000, due: 30000, profit: 15000 - (14000 - 11000) });
  });

  it('groups items by category, brand and product; finds dead stock', async () => {
    const { app, adminToken } = await setup();
    expect((await call(app, adminToken, 'GET', '/api/reports/items')).body.rows[0]).toMatchObject({ name: 'Wires', amount: 70000, profit: 15000 });
    expect((await call(app, adminToken, 'GET', '/api/reports/items?group=brand')).body.rows[0].name).toBe('PC');
    expect((await call(app, adminToken, 'GET', '/api/reports/top')).body.rows[0]).toMatchObject({ code: 'W-1', qty: 10 });
    const dead = (await call(app, adminToken, 'GET', '/api/reports/dead')).body.rows;
    expect(dead.map((d: { code: string }) => d.code)).toEqual(['P-1']);
  });

  it('udhaar, stock value, staff', async () => {
    const { app, adminToken } = await setup();
    expect((await call(app, adminToken, 'GET', '/api/reports/udhaar')).body.rows[0]).toMatchObject({ name: 'Rashid', balance: 30000 });
    const stock = (await call(app, adminToken, 'GET', '/api/reports/stock')).body.rows;
    expect(stock.find((s: { name: string }) => s.name === 'Wires').costValue).toBe(890 * 5500);
    expect((await call(app, adminToken, 'GET', '/api/reports/staff?group=device')).body.rows[0]).toMatchObject({ name: 'Counter A', bills: 1 });
  });

  it('exports Excel and is Admin only', async () => {
    const { app, adminToken, cashierToken } = await setup();
    const res = await app.inject({ method: 'GET', url: `/api/reports/sales?format=xlsx&token=${adminToken}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect((await call(app, cashierToken, 'GET', '/api/reports/sales')).status).toBe(403);
    expect((await call(app, adminToken, 'GET', '/api/reports/nope')).body.code).toBe('NO_REPORT');
  });

  it('dashboard shows profit only to Admin', async () => {
    const { app, adminToken, cashierToken } = await setup();
    const a = (await call(app, adminToken, 'GET', '/api/dashboard')).body;
    expect(a.today).toMatchObject({ bills: 1, total: 70000, cash: 40000, udhaar: 30000, profit: 15000 });
    expect(a.days).toHaveLength(7);
    expect(a.days[6].total).toBe(70000);
    const c = (await call(app, cashierToken, 'GET', '/api/dashboard')).body;
    expect(c.today.profit).toBeUndefined();
    expect(c.days[6].profit).toBeUndefined();
  });
});
