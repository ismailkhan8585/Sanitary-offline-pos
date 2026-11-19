import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { suppliers } from '../db/schema';
import { actorOf, requirePerm } from '../lib/auth';
import { logActivity } from '../lib/activity';
import { notFound } from '../lib/errors';
import { allBalances, supplierBalance, supplierLedger } from '../lib/ledger';

const supplierInput = z.object({
  name: z.string().trim().min(1).max(80),
  company: z.string().trim().max(80).default(''),
  phone: z.string().trim().max(30).default(''),
  openingBalance: z.number().int().default(0),
});
const idParam = z.object({ id: z.coerce.number().int() });

export function supplierRoutes(app: FastifyInstance): void {
  const { db } = app.ctx;
  const guard = { preHandler: requirePerm('party.manage') };

  app.get('/api/suppliers', guard, async () => {
    const balances = allBalances(db, 'supplier');
    return db
      .select()
      .from(suppliers)
      .orderBy(suppliers.name)
      .all()
      .map((s) => ({ ...s, balance: balances.get(s.id) ?? 0 }));
  });

  app.get('/api/suppliers/:id/ledger', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const supplier = db.select().from(suppliers).where(eq(suppliers.id, id)).get();
    if (!supplier) throw notFound('Supplier');
    return { party: { ...supplier, balance: supplierBalance(db, id) }, entries: supplierLedger(db, id) };
  });

  app.post('/api/suppliers', guard, async (req) => {
    const created = db.insert(suppliers).values(supplierInput.parse(req.body)).returning().get();
    logActivity(db, actorOf(req), 'supplier.create', created);
    return { ...created, balance: supplierBalance(db, created.id) };
  });

  app.put('/api/suppliers/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const updated = db.update(suppliers).set(supplierInput.partial().parse(req.body)).where(eq(suppliers.id, id)).returning().get();
    if (!updated) throw notFound('Supplier');
    logActivity(db, actorOf(req), 'supplier.update', updated);
    return { ...updated, balance: supplierBalance(db, id) };
  });
}
