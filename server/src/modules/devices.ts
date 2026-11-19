import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { devices } from '../db/schema';
import { requirePerm, actorOf } from '../lib/auth';
import { badRequest, notFound } from '../lib/errors';
import { logActivity } from '../lib/activity';

const deviceSchema = z.object({
  name: z.string().trim().min(1).max(40),
  billPrefix: z.string().regex(/^[A-Z]$/, 'Bill prefix must be one capital letter'),
  active: z.boolean().default(true),
});
const idParam = z.object({ id: z.coerce.number().int() });

export function deviceRoutes(app: FastifyInstance): void {
  const { db } = app.ctx;
  const guard = { preHandler: requirePerm('settings') };

  app.get('/api/devices/public', { config: { public: true } }, async () =>
    db
      .select({ id: devices.id, name: devices.name, billPrefix: devices.billPrefix })
      .from(devices)
      .where(eq(devices.active, true))
      .all(),
  );

  app.get('/api/devices', guard, async () => db.select().from(devices).all());

  app.post('/api/devices', guard, async (req) => {
    const body = deviceSchema.parse(req.body);
    if (db.select().from(devices).where(eq(devices.billPrefix, body.billPrefix)).get()) {
      throw badRequest('PREFIX_TAKEN', 'Another counter already uses this bill letter.');
    }
    const created = db.insert(devices).values(body).returning().get();
    logActivity(db, actorOf(req), 'device.create', created);
    return created;
  });

  app.put('/api/devices/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = deviceSchema.partial().parse(req.body);
    const clash = body.billPrefix ? db.select().from(devices).where(eq(devices.billPrefix, body.billPrefix)).get() : undefined;
    if (clash && clash.id !== id) throw badRequest('PREFIX_TAKEN', 'Another counter already uses this bill letter.');
    const updated = db.update(devices).set(body).where(eq(devices.id, id)).returning().get();
    if (!updated) throw notFound('Counter');
    logActivity(db, actorOf(req), 'device.update', updated);
    return updated;
  });
}
