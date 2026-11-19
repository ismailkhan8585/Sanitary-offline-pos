import { afterEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { FastifyInstance } from 'fastify';
import { addProduct, call, createTestEnv, wire } from './helpers';
import { topicsFor } from '../src/lib/realtime';

let app: FastifyInstance | undefined;
const sockets: Socket[] = [];

afterEach(async () => {
  sockets.splice(0).forEach((s) => s.close());
  await app?.close();
  app = undefined;
});

function open(url: string, token: string): Promise<Socket> {
  const s = connect(url, { path: '/socket.io', auth: { token }, transports: ['websocket'], reconnection: false });
  sockets.push(s);
  return new Promise((resolve, reject) => {
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}

const next = <T>(s: Socket, event: string) => new Promise<T>((resolve) => s.once(event, resolve));

describe('live updates', () => {
  it('maps routes to the data they change', () => {
    expect(topicsFor('/api/sales')).toContain('products');
    expect(topicsFor('/api/sales/:id/cancel')).toContain('sales');
    expect(topicsFor('/api/payments')).toContain('ledger');
    expect(topicsFor('/api/health')).toEqual([]);
  });

  it('tells every counter what changed after a sale, and rejects bad tokens', async () => {
    const env = await createTestEnv();
    app = env.app;
    const wireId = await addProduct(env.app, env.adminToken, wire, 100);
    await env.app.listen({ port: 0, host: '127.0.0.1' });
    const address = env.app.server.address();
    const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

    await expect(open(url, 'bad-token')).rejects.toThrow('UNAUTHORIZED');
    const counterA = await open(url, env.cashierToken);
    const presence = next<{ userName: string }[]>(counterA, 'presence');
    const counterB = await open(url, env.adminToken);
    expect((await presence).map((p) => p.userName).sort()).toEqual(['Admin', 'Ali']);

    const changed = next<{ topics: string[]; deviceId: number }>(counterB, 'changed');
    const sale = await call(env.app, env.cashierToken, 'POST', '/api/sales', { items: [{ productId: wireId, qty: 1, unit: 'metre', rate: 7000 }], paid: 7000 });
    expect(sale.status).toBe(200);
    const msg = await changed;
    expect(msg.topics).toEqual(expect.arrayContaining(['products', 'sales', 'dashboard']));
    expect(msg.deviceId).toBe(1);
  });
});
