import { describe, expect, it } from 'vitest';
import { hashPin, verifyPin } from '../src/lib/pin';
import { signToken, verifyToken } from '../src/lib/token';
import { can } from '../src/shared/permissions';
import { openDatabase } from '../src/db';
import { call, createTestEnv, migrationsDir } from './helpers';

describe('pin hashing', () => {
  it('verifies the right PIN only', () => {
    const h = hashPin('4321');
    expect(verifyPin('4321', h)).toBe(true);
    expect(verifyPin('4322', h)).toBe(false);
    expect(verifyPin('4321', 'garbage')).toBe(false);
  });
});

describe('tokens', () => {
  it('rejects tampered and expired tokens', () => {
    const t = signToken({ uid: 1, did: 1, exp: Date.now() + 1000 }, 's');
    expect(verifyToken(t, 's')?.uid).toBe(1);
    expect(verifyToken(t, 'other')).toBeNull();
    expect(verifyToken(t.replace(/^./, 'x'), 's')).toBeNull();
    expect(verifyToken(t, 's', Date.now() + 2000)).toBeNull();
  });
});

describe('permissions', () => {
  it('limits cashiers', () => {
    expect(can('cashier', 'sale')).toBe(true);
    expect(can('cashier', 'cost.view')).toBe(false);
    expect(can('cashier', 'sale.cancel')).toBe(false);
    expect(can('admin', 'sale.cancel')).toBe(true);
  });
});

describe('database', () => {
  it('opens with foreign keys and busy timeout', () => {
    const { sqlite } = openDatabase(':memory:', migrationsDir);
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(sqlite.pragma('busy_timeout', { simple: true })).toBe(5000);
  });
});

describe('auth routes', () => {
  it('logs in with PIN and blocks after repeated wrong PINs', async () => {
    const { app } = await createTestEnv();
    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { userId: 1, pin: '0000', deviceId: 1 } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().code).toBe('WRONG_PIN');
    for (let i = 0; i < 5; i++) {
      await app.inject({ method: 'POST', url: '/api/auth/login', payload: { userId: 1, pin: '0000', deviceId: 1 } });
    }
    const locked = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { userId: 1, pin: '1234', deviceId: 1 } });
    expect(locked.statusCode).toBe(429);
  });

  it('requires a token for API calls', async () => {
    const { app } = await createTestEnv();
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('returns the logged-in user and counter', async () => {
    const { app, cashierToken } = await createTestEnv();
    const me = await call(app, cashierToken, 'GET', '/api/auth/me');
    expect(me.body.role).toBe('cashier');
    expect(me.body.device.billPrefix).toBe('A');
  });

  it('checks permissions on the server', async () => {
    const { app, adminToken, cashierToken } = await createTestEnv();
    expect((await call(app, cashierToken, 'GET', '/api/users')).status).toBe(403);
    expect((await call(app, adminToken, 'GET', '/api/users')).status).toBe(200);
    expect((await call(app, cashierToken, 'PUT', '/api/settings', { tax_pct: '5' })).status).toBe(403);
  });

  it('keeps at least one active admin', async () => {
    const { app, adminToken } = await createTestEnv();
    const res = await call(app, adminToken, 'PUT', '/api/users/1', { active: false });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('LAST_ADMIN');
  });

  it('verifies admin PIN for counter setup', async () => {
    const { app } = await createTestEnv();
    const ok = await app.inject({ method: 'POST', url: '/api/auth/verify-admin', payload: { pin: '1234' } });
    expect(ok.json().ok).toBe(true);
    const no = await app.inject({ method: 'POST', url: '/api/auth/verify-admin', payload: { pin: '1111' } });
    expect(no.statusCode).toBe(401);
  });

  it('rejects duplicate bill prefixes', async () => {
    const { app, adminToken } = await createTestEnv();
    const res = await call(app, adminToken, 'POST', '/api/devices', { name: 'Counter X', billPrefix: 'A' });
    expect(res.body.code).toBe('PREFIX_TAKEN');
    const ok = await call(app, adminToken, 'POST', '/api/devices', { name: 'Counter B', billPrefix: 'B' });
    expect(ok.status).toBe(200);
  });
});
