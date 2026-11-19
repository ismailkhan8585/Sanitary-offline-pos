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
  const app = buildApp(database);
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

/** Calls the API as a logged-in user and returns status + parsed JSON. */
export async function call(app: FastifyInstance, token: string, method: Method, url: string, payload?: unknown) {
  const res = await app.inject({ method, url, payload: payload as object, headers: { authorization: `Bearer ${token}` } });
  const body = res.headers['content-type']?.toString().includes('json') ? res.json() : res.body;
  return { status: res.statusCode, body };
}
