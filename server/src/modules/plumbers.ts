import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { plumbers } from '../db/schema';
import { actorOf, requirePerm } from '../lib/auth';
import { logActivity } from '../lib/activity';
import { notFound } from '../lib/errors';

const plumberInput = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(30).default(''),
  commissionPct: z.number().min(0).max(50).default(0),
});
const idParam = z.object({ id: z.coerce.number().int() });

export function plumberRoutes(app: FastifyInstance): void {
  const { db } = app.ctx;
  const write = { preHandler: requirePerm('party.manage') };

  app.get('/api/plumbers', async () => db.select().from(plumbers).orderBy(plumbers.name).all());

  app.post('/api/plumbers', write, async (req) => {
    const created = db.insert(plumbers).values(plumberInput.parse(req.body)).returning().get();
    logActivity(db, actorOf(req), 'plumber.create', created);
    return created;
  });

  app.put('/api/plumbers/:id', write, async (req) => {
    const { id } = idParam.parse(req.params);
    const updated = db.update(plumbers).set(plumberInput.partial().parse(req.body)).where(eq(plumbers.id, id)).returning().get();
    if (!updated) throw notFound('Plumber');
    logActivity(db, actorOf(req), 'plumber.update', updated);
    return updated;
  });
}
