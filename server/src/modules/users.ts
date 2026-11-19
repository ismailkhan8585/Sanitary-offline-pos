import type { FastifyInstance } from 'fastify';
import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { users } from '../db/schema';
import { requirePerm, actorOf } from '../lib/auth';
import { badRequest, notFound } from '../lib/errors';
import { hashPin } from '../lib/pin';
import { logActivity } from '../lib/activity';

const pin = z.string().regex(/^\d{4,8}$/, 'PIN must be 4 to 8 digits');
const base = z.object({
  name: z.string().trim().min(1).max(60),
  role: z.enum(['admin', 'cashier']),
  discountLimitPct: z.number().min(0).max(100),
  returnLimit: z.number().int().min(0),
  expenseLimit: z.number().int().min(0),
  active: z.boolean(),
});
const createSchema = base.extend({ pin });
const updateSchema = base.partial().extend({ pin: pin.optional() });
const idParam = z.object({ id: z.coerce.number().int() });

const publicFields = {
  id: users.id,
  name: users.name,
  role: users.role,
  discountLimitPct: users.discountLimitPct,
  returnLimit: users.returnLimit,
  expenseLimit: users.expenseLimit,
  active: users.active,
};

export function userRoutes(app: FastifyInstance): void {
  const { db } = app.ctx;
  const guard = { preHandler: requirePerm('user.manage') };

  app.get('/api/users', guard, async () => db.select(publicFields).from(users).all());

  app.post('/api/users', guard, async (req) => {
    const { pin: p, ...rest } = createSchema.parse(req.body);
    const created = db
      .insert(users)
      .values({ ...rest, pinHash: hashPin(p) })
      .returning(publicFields)
      .get();
    logActivity(db, actorOf(req), 'user.create', { id: created.id, name: created.name, role: created.role });
    return created;
  });

  app.put('/api/users/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const { pin: p, ...rest } = updateSchema.parse(req.body);
    const current = db.select().from(users).where(eq(users.id, id)).get();
    if (!current) throw notFound('User');
    const losesAdmin = current.role === 'admin' && (rest.role === 'cashier' || rest.active === false);
    if (losesAdmin) {
      const otherAdmin = db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, 'admin'), eq(users.active, true), ne(users.id, id)))
        .get();
      if (!otherAdmin) throw badRequest('LAST_ADMIN', 'At least one active Admin is needed.');
    }
    const updated = db
      .update(users)
      .set({ ...rest, ...(p ? { pinHash: hashPin(p) } : {}) })
      .where(eq(users.id, id))
      .returning(publicFields)
      .get();
    logActivity(db, actorOf(req), 'user.update', { id, changes: Object.keys(rest), pinChanged: Boolean(p) });
    return updated;
  });
}
