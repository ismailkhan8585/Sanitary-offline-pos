import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { products } from '../db/schema';
import { actorOf, requirePerm } from '../lib/auth';
import { logActivity } from '../lib/activity';
import { transaction } from '../lib/tx';
import { badRequest, notFound } from '../lib/errors';
import { currentStock, moveStock } from '../lib/stock';

const damageInput = z.object({ productId: z.number().int(), qty: z.number().positive(), note: z.string().max(200).default('') });
const countInput = z.object({
  items: z.array(z.object({ productId: z.number().int(), countedQty: z.number().min(0) })).min(1),
  note: z.string().max(200).default(''),
});

export function stockRoutes(app: FastifyInstance): void {
  const { db, sqlite } = app.ctx;
  const guard = { preHandler: requirePerm('stock.adjust') };

  /** Damaged / broken goods taken out of stock. */
  app.post('/api/stock/damage', guard, async (req) => {
    const body = damageInput.parse(req.body);
    const actor = actorOf(req);
    return transaction(sqlite, () => {
      const p = db.select().from(products).where(eq(products.id, body.productId)).get();
      if (!p) throw notFound('Product');
      if (body.qty > currentStock(db, p.id)) throw badRequest('NOT_ENOUGH_STOCK', `Only ${currentStock(db, p.id)} in stock.`, { name: p.nameEn });
      moveStock(db, { productId: p.id, qty: -body.qty, type: 'damage', ...actor });
      logActivity(db, actor, 'stock.damage', { productId: p.id, code: p.code, qty: body.qty, note: body.note });
      return { stock: currentStock(db, p.id) };
    });
  });

  /** Stock count: sets each product to the counted quantity with an "adjust" movement for the difference. */
  app.post('/api/stock/count', guard, async (req) => {
    const body = countInput.parse(req.body);
    const actor = actorOf(req);
    return transaction(sqlite, () => {
      const changes: { productId: number; from: number; to: number }[] = [];
      for (const item of body.items) {
        if (!db.select({ id: products.id }).from(products).where(eq(products.id, item.productId)).get()) throw notFound('Product');
        const from = currentStock(db, item.productId);
        const diff = Math.round((item.countedQty - from) * 1000) / 1000;
        if (diff === 0) continue;
        moveStock(db, { productId: item.productId, qty: diff, type: 'adjust', ...actor });
        changes.push({ productId: item.productId, from, to: item.countedQty });
      }
      logActivity(db, actor, 'stock.count', { changes, note: body.note });
      return { changed: changes.length };
    });
  });
}
