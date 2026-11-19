import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { devices, users } from '../db/schema';
import { AppError } from '../lib/errors';
import { verifyPin } from '../lib/pin';
import { signToken } from '../lib/token';
import { auth } from '../lib/auth';
import { logActivity } from '../lib/activity';
import { createLimiter } from '../lib/limiter';
import { findAdminByPin } from '../lib/admin-pin';

const SESSION_MS = 14 * 60 * 60 * 1000;
const loginSchema = z.object({ userId: z.number().int(), pin: z.string().min(4).max(8), deviceId: z.number().int().nullable() });
const pinSchema = z.object({ pin: z.string().min(4).max(8) });

export function authRoutes(app: FastifyInstance, secret: string): void {
  const { db } = app.ctx;
  const limiter = createLimiter(5, 60_000);

  app.get('/api/auth/users', { config: { public: true } }, async () =>
    db.select({ id: users.id, name: users.name, role: users.role }).from(users).where(eq(users.active, true)).all(),
  );

  app.post('/api/auth/login', { config: { public: true } }, async (req) => {
    const body = loginSchema.parse(req.body);
    const key = `user:${body.userId}`;
    limiter.check(key);
    const user = db
      .select()
      .from(users)
      .where(and(eq(users.id, body.userId), eq(users.active, true)))
      .get();
    if (!user || !verifyPin(body.pin, user.pinHash)) {
      limiter.fail(key);
      throw new AppError(401, 'WRONG_PIN', 'Wrong PIN. Try again.');
    }
    limiter.reset(key);
    const device = body.deviceId ? db.select().from(devices).where(eq(devices.id, body.deviceId)).get() : undefined;
    const deviceId = device?.active ? device.id : null;
    logActivity(db, { userId: user.id, deviceId }, 'login');
    return {
      token: signToken({ uid: user.id, did: deviceId, exp: Date.now() + SESSION_MS }, secret),
      user: { id: user.id, name: user.name, role: user.role },
    };
  });

  app.get('/api/auth/me', async (req) => {
    const a = auth(req);
    const device = a.deviceId ? db.select().from(devices).where(eq(devices.id, a.deviceId)).get() : undefined;
    return { ...a, device: device ?? null };
  });

  /** Checks an Admin PIN without logging in (used to set up a counter). */
  app.post('/api/auth/verify-admin', { config: { public: true } }, async (req) => {
    const { pin } = pinSchema.parse(req.body);
    limiter.check('admin-pin');
    const admin = findAdminByPin(db, pin);
    if (!admin) {
      limiter.fail('admin-pin');
      throw new AppError(401, 'WRONG_ADMIN_PIN', 'Wrong Admin PIN.');
    }
    limiter.reset('admin-pin');
    return { ok: true, adminId: admin.id, name: admin.name };
  });
}
