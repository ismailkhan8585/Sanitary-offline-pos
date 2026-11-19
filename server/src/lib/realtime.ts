import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import { eq } from 'drizzle-orm';
import { users } from '../db/schema';
import { verifyToken } from './token';

/**
 * Which data each kind of write changes. Topic names equal the client's query keys,
 * so every counter simply refetches those lists.
 */
const TOPICS: [prefix: string, topics: string[]][] = [
  ['/api/sales', ['sales', 'products', 'customers', 'plumbers', 'ledger', 'dashboard', 'shift', 'report']],
  ['/api/returns', ['returns', 'sales', 'products', 'customers', 'plumbers', 'ledger', 'dashboard', 'shift', 'report']],
  ['/api/challans', ['challans', 'products', 'customers', 'ledger', 'sales', 'dashboard', 'shift', 'report']],
  ['/api/purchases', ['purchases', 'products', 'suppliers', 'ledger', 'dashboard', 'shift', 'report']],
  ['/api/payments', ['customers', 'suppliers', 'plumbers', 'ledger', 'dashboard', 'shift', 'report']],
  ['/api/products', ['products', 'movements', 'categories', 'dashboard', 'report']],
  ['/api/categories', ['categories', 'products']],
  ['/api/stock', ['products', 'movements', 'dashboard', 'report']],
  ['/api/customers', ['customers', 'ledger']],
  ['/api/suppliers', ['suppliers', 'ledger']],
  ['/api/plumbers', ['plumbers', 'ledger']],
  ['/api/expenses', ['expenses', 'shift', 'dashboard', 'report']],
  ['/api/shifts', ['shift']],
  ['/api/settings', ['settings']],
  ['/api/users', ['users', 'auth']],
  ['/api/devices', ['devices']],
  ['/api/emergency', ['sales', 'products', 'customers', 'dashboard', 'shift', 'report']],
];

export function topicsFor(route: string): string[] {
  return TOPICS.find(([prefix]) => route === prefix || route.startsWith(`${prefix}/`))?.[1] ?? [];
}

export interface Presence {
  deviceId: number | null;
  userName: string;
}

/** Live updates: every successful write tells all counters what to refresh; also tracks who is online. */
export function attachRealtime(app: FastifyInstance, secret: string): Server {
  const io = new Server(app.server, { path: '/socket.io', serveClient: false });

  io.use((socket, next) => {
    const payload = verifyToken(String(socket.handshake.auth?.token ?? ''), secret);
    const user = payload ? app.ctx.db.select().from(users).where(eq(users.id, payload.uid)).get() : undefined;
    if (!payload || !user?.active) return next(new Error('UNAUTHORIZED'));
    socket.data = { deviceId: payload.did, userName: user.name } satisfies Presence;
    next();
  });

  const broadcastPresence = () => {
    const list = [...io.sockets.sockets.values()].map((s) => s.data as Presence);
    io.emit('presence', list);
  };
  io.on('connection', (socket) => {
    broadcastPresence();
    socket.on('disconnect', broadcastPresence);
  });

  app.addHook('onResponse', async (req, reply) => {
    if (req.method === 'GET' || reply.statusCode >= 400) return;
    const topics = topicsFor(req.routeOptions.url ?? req.url);
    if (topics.length) io.emit('changed', { topics, deviceId: req.authInfo?.deviceId ?? null });
  });
  app.addHook('onClose', async () => {
    io.close();
  });
  return io;
}
