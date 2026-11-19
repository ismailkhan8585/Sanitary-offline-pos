import type { FastifyInstance, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Database } from '../db';
import { devices, users } from '../db/schema';
import { can, type Permission, type Role } from '../shared/permissions';
import { AppError, forbidden } from './errors';
import { verifyToken } from './token';
import type { Actor } from './activity';

export interface AuthInfo {
  userId: number;
  name: string;
  role: Role;
  deviceId: number | null;
  discountLimitPct: number;
  returnLimit: number;
  expenseLimit: number;
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: Database;
  }
  interface FastifyRequest {
    authInfo: AuthInfo | null;
  }
  interface FastifyContextConfig {
    public?: boolean;
  }
}

const SEEN_INTERVAL_MS = 30_000;

export function registerAuth(app: FastifyInstance, secret: string): void {
  const lastSeenWrite = new Map<number, number>();
  app.decorateRequest('authInfo', null);
  app.addHook('onRequest', async (req) => {
    // Decide by the matched route (not the raw URL) so odd URL spellings cannot skip the check.
    const route = req.routeOptions.url;
    const isApi = route ? route.startsWith('/api/') : req.url.startsWith('/api');
    if (!isApi || req.routeOptions.config?.public) return;
    const header = req.headers.authorization;
    const query = req.query as Record<string, string | undefined>;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : query?.token;
    const payload = token ? verifyToken(token, secret) : null;
    const user = payload ? app.ctx.db.select().from(users).where(eq(users.id, payload.uid)).get() : undefined;
    if (!payload || !user || !user.active) throw new AppError(401, 'UNAUTHORIZED', 'Please log in again.');
    req.authInfo = {
      userId: user.id,
      name: user.name,
      role: user.role,
      deviceId: payload.did,
      discountLimitPct: user.discountLimitPct,
      returnLimit: user.returnLimit,
      expenseLimit: user.expenseLimit,
    };
    const now = Date.now();
    if (payload.did && now - (lastSeenWrite.get(payload.did) ?? 0) > SEEN_INTERVAL_MS) {
      lastSeenWrite.set(payload.did, now);
      app.ctx.db.update(devices).set({ lastSeen: now }).where(eq(devices.id, payload.did)).run();
    }
  });
}

export function auth(req: FastifyRequest): AuthInfo {
  if (!req.authInfo) throw new AppError(401, 'UNAUTHORIZED', 'Please log in again.');
  return req.authInfo;
}

export function actorOf(req: FastifyRequest): Actor {
  const a = auth(req);
  return { userId: a.userId, deviceId: a.deviceId };
}

/** Route preHandler: rejects the request unless the logged-in role has the permission. */
export function requirePerm(permission: Permission) {
  return async (req: FastifyRequest) => {
    if (!can(auth(req).role, permission)) throw forbidden();
  };
}
