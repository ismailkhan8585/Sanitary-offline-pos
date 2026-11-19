import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { plumbers } from '../db/schema';
import { actorOf, auth, requirePerm } from '../lib/auth';
import { logActivity } from '../lib/activity';
import { notFound } from '../lib/errors';
import { allBalances, plumberBalance, plumberLedger } from '../lib/ledger';

const plumberInput = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(30).default(''),
  commissionPct: z.number().min(0).max(50).default(0),
});
const idParam = z.object({ id: z.coerce.number().int() });

export function plumberRoutes(app: FastifyInstance): void {
  const { db } = app.ctx;
  const manage = { preHandler: requirePerm('party.manage') };

  /** Everyone needs the list for the POS; only Admin sees what the shop owes each plumber. */
  app.get('/api/plumbers', async (req) => {
    const rows = db.select().from(plumbers).orderBy(plumbers.name).all();
    if (auth(req).role !== 'admin') return rows;
    const balances = allBalances(db, 'plumber');
    return rows.map((p) => ({ ...p, balance: balances.get(p.id) ?? 0 }));
  });

  app.get('/api/plumbers/:id/ledger', manage, async (req) => {
    const { id } = idParam.parse(req.params);
    const plumber = db.select().from(plumbers).where(eq(plumbers.id, id)).get();
    if (!plumber) throw notFound('Plumber');
    return { party: { ...plumber, balance: plumberBalance(db, id) }, entries: plumberLedger(db, id) };
  });

  app.post('/api/plumbers', manage, async (req) => {
    const created = db.insert(plumbers).values(plumberInput.parse(req.body)).returning().get();
    logActivity(db, actorOf(req), 'plumber.create', created);
    return created;
  });

  app.put('/api/plumbers/:id', manage, async (req) => {
    const { id } = idParam.parse(req.params);
    const updated = db.update(plumbers).set(plumberInput.partial().parse(req.body)).where(eq(plumbers.id, id)).returning().get();
    if (!updated) throw notFound('Plumber');
    logActivity(db, actorOf(req), 'plumber.update', updated);
    return updated;
  });
}
