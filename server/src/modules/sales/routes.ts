import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, like, lte, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { customers, devices, products, saleItems, sales, saleStatuses, users } from '../../db/schema';
import { actorOf, auth, requirePerm } from '../../lib/auth';
import { transaction } from '../../lib/tx';
import { badRequest, notFound } from '../../lib/errors';
import { logActivity } from '../../lib/activity';
import { can } from '../../shared/permissions';
import { cancelSale, exchangeCredit, heldSales, hideSaleCost, prepareSale, saleDetail, saleInput, writeSale } from './service';

const idParam = z.object({ id: z.coerce.number().int() });
const listQuery = z.object({
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  status: z.enum(saleStatuses).optional(),
  q: z.string().trim().optional(),
  customerId: z.coerce.number().int().optional(),
  mine: z.coerce.boolean().optional(),
});

export function salesRoutes(app: FastifyInstance): void {
  const { db, sqlite } = app.ctx;
  const sell = { preHandler: requirePerm('sale') };

  app.post('/api/sales', sell, async (req) => {
    const input = saleInput.parse(req.body);
    const actor = actorOf(req);
    const sale = transaction(sqlite, () => {
      const credit = input.exchangeReturnId && input.status === 'done' ? exchangeCredit(db, input.exchangeReturnId) : 0;
      const prepared = prepareSale(db, input, credit);
      return writeSale(db, input, prepared, actor, credit ? { creditApplied: credit, exchangeReturnId: input.exchangeReturnId } : {});
    });
    return hideSaleCost(saleDetail(db, sale.id), can(auth(req).role, 'cost.view'));
  });

  app.get('/api/sales', async (req) => {
    const q = listQuery.parse(req.query);
    const a = auth(req);
    const where: (SQL | undefined)[] = [
      q.from ? gte(sales.createdAt, q.from) : undefined,
      q.to ? lte(sales.createdAt, q.to) : undefined,
      q.status ? eq(sales.status, q.status) : undefined,
      q.customerId ? eq(sales.customerId, q.customerId) : undefined,
      q.mine ? eq(sales.userId, a.userId) : undefined,
      q.q ? or(like(sales.billNo, `%${q.q}%`), like(customers.name, `%${q.q}%`), like(customers.phone, `%${q.q}%`)) : undefined,
    ];
    return db
      .select({
        id: sales.id,
        billNo: sales.billNo,
        createdAt: sales.createdAt,
        total: sales.total,
        paid: sales.paid,
        due: sales.due,
        discount: sales.discount,
        status: sales.status,
        paymentMethod: sales.paymentMethod,
        cancelReason: sales.cancelReason,
        customerName: customers.name,
        userName: users.name,
        deviceName: devices.name,
      })
      .from(sales)
      .leftJoin(customers, eq(customers.id, sales.customerId))
      .leftJoin(users, eq(users.id, sales.userId))
      .leftJoin(devices, eq(devices.id, sales.deviceId))
      .where(and(...where))
      .orderBy(desc(sales.id))
      .limit(500)
      .all();
  });

  app.get('/api/sales/open', sell, async (req) => heldSales(db, auth(req).deviceId));

  /** Fast-moving items of the last 30 days, for the POS quick buttons. */
  app.get('/api/sales/top-products', sell, async () => {
    const since = Date.now() - 30 * 86_400_000;
    return db
      .select({ productId: saleItems.productId, count: sql<number>`count(*)` })
      .from(saleItems)
      .innerJoin(sales, eq(sales.id, saleItems.saleId))
      .innerJoin(products, eq(products.id, saleItems.productId))
      .where(and(eq(sales.status, 'done'), gte(sales.createdAt, since), eq(products.active, true)))
      .groupBy(saleItems.productId)
      .orderBy(sql`count(*) DESC`)
      .limit(12)
      .all();
  });

  app.get('/api/sales/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    return hideSaleCost(saleDetail(db, id), can(auth(req).role, 'cost.view'));
  });

  app.post('/api/sales/:id/cancel', { preHandler: requirePerm('sale.cancel') }, async (req) => {
    const { id } = idParam.parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(3).max(200) }).parse(req.body);
    transaction(sqlite, () => cancelSale(db, id, reason, actorOf(req)));
    return saleDetail(db, id);
  });

  /** Throws away a held bill or quotation (never a finished bill). */
  app.post('/api/sales/:id/discard', sell, async (req) => {
    const { id } = idParam.parse(req.params);
    const sale = db.select().from(sales).where(eq(sales.id, id)).get();
    if (!sale) throw notFound('Bill');
    if (sale.status !== 'held' && sale.status !== 'quotation') throw badRequest('NOT_OPEN_BILL', 'Only held bills and quotations can be removed.');
    db.update(sales).set({ status: 'cancelled', cancelReason: 'Discarded' }).where(eq(sales.id, id)).run();
    logActivity(db, actorOf(req), 'sale.discard', { id, billNo: sale.billNo });
    return { ok: true };
  });
}
