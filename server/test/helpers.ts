import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { openDatabase } from '../src/db';
import { seed } from '../src/db/seed';
import { buildApp } from '../src/app';
import { users } from '../src/db/schema';
import { hashPin } from '../src/lib/pin';

export const migrationsDir = path.resolve(__dirname, '../migrations');

export interface TestEnv {
  app: FastifyInstance;
  adminToken: string;
  cashierToken: string;
  cashierId: number;
}

/** Fresh in-memory database + app, with Admin (PIN 1234) and a cashier (PIN 1111) logged in on counter A. */
export async function createTestEnv(): Promise<TestEnv> {
  const database = openDatabase(':memory:', migrationsDir);
  seed(database.db);
  const cashier = database.db
    .insert(users)
    .values({ name: 'Ali', role: 'cashier', pinHash: hashPin('1111'), discountLimitPct: 5, returnLimit: 200000, expenseLimit: 100000 })
    .returning()
    .get();
  const app = buildApp(database, { hardwareId: 'TEST-0000-0000-0000' });
  await app.ready();
  const adminToken = await login(app, 1, '1234');
  const cashierToken = await login(app, cashier.id, '1111');
  return { app, adminToken, cashierToken, cashierId: cashier.id };
}

export async function login(app: FastifyInstance, userId: number, pin: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { userId, pin, deviceId: 1 } });
  if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
  return res.json().token;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export const pipe = {
  code: 'P-1',
  nameEn: 'PVC Pipe 1/2"',
  nameUr: 'پائپ',
  aliases: 'paip',
  unit: 'foot',
  packUnit: 'length',
  packQty: 13,
  costPrice: 3000,
  retailPrice: 4000,
  plumberPrice: 3700,
  wholesalePrice: 3500,
  minStock: 50,
};

export const wire = {
  code: 'W-1',
  nameEn: 'Wire 1.5mm',
  unit: 'metre',
  packUnit: 'coil',
  packQty: 90,
  costPrice: 5500,
  retailPrice: 7000,
  plumberPrice: 6600,
  wholesalePrice: 6200,
  minStock: 90,
};

/** Creates a product as Admin and returns its id. */
export async function addProduct(app: FastifyInstance, adminToken: string, data: object, openingStock = 0): Promise<number> {
  const res = await call(app, adminToken, 'POST', '/api/products', { ...data, openingStock });
  if (res.status !== 200) throw new Error(`addProduct failed: ${JSON.stringify(res.body)}`);
  return res.body.id;
}

/** Calls the API as a logged-in user and returns status + parsed JSON. */
export async function call(app: FastifyInstance, token: string, method: Method, url: string, payload?: unknown) {
  const res = await app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${token}` } });
  const body = res.headers['content-type']?.toString().includes('json') ? res.json() : res.body;
  return { status: res.statusCode, body };
}
