import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { customers, priceTiers } from '../db/schema';
import { actorOf, requirePerm } from '../lib/auth';
import { logActivity } from '../lib/activity';
import { notFound } from '../lib/errors';

export const customerInput = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(30).default(''),
  address: z.string().trim().max(200).default(''),
  creditLimit: z.number().int().min(0).default(0),
  priceTier: z.enum(priceTiers).default('retail'),
  openingBalance: z.number().int().default(0),
});

const idParam = z.object({ id: z.coerce.number().int() });

export function customerRoutes(app: FastifyInstance): void {
  const { db } = app.ctx;
  const write = { preHandler: requirePerm('customer.write') };

  app.get('/api/customers', async () => db.select().from(customers).orderBy(customers.name).all());

  app.post('/api/customers', write, async (req) => {
    const created = db.insert(customers).values(customerInput.parse(req.body)).returning().get();
    logActivity(db, actorOf(req), 'customer.create', { id: created.id, name: created.name });
    return created;
  });

  /** Cashiers may fix contact details; credit limit and opening balance need Admin. */
  app.put('/api/customers/:id', write, async (req) => {
    const { id } = idParam.parse(req.params);
    const body = customerInput.partial().parse(req.body);
    const isAdmin = req.authInfo?.role === 'admin';
    const allowed = isAdmin ? body : { name: body.name, phone: body.phone, address: body.address };
    const updated = db.update(customers).set(allowed).where(eq(customers.id, id)).returning().get();
    if (!updated) throw notFound('Customer');
    logActivity(db, actorOf(req), 'customer.update', { id, changes: Object.keys(allowed) });
    return updated;
  });
}
