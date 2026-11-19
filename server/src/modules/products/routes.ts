import type { FastifyInstance } from 'fastify';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { categories, products, stockMovements, users } from '../../db/schema';
import { actorOf, auth, requirePerm } from '../../lib/auth';
import { logActivity } from '../../lib/activity';
import { transaction } from '../../lib/tx';
import { notFound } from '../../lib/errors';
import { can } from '../../shared/permissions';
import { adjustPrice, createProduct, hideCost, listProducts, PRICE_FIELDS, productInput, updateProduct } from './service';

const idParam = z.object({ id: z.coerce.number().int() });
const categoryInput = z.object({ nameEn: z.string().trim().min(1).max(60), nameUr: z.string().trim().max(60).default('') });
const priceUpdateInput = z.object({
  brand: z.string().trim().min(1),
  pct: z.number().min(-90).max(500),
  fields: z.array(z.enum(PRICE_FIELDS)).min(1),
});

export function productRoutes(app: FastifyInstance): void {
  const { db, sqlite } = app.ctx;
  const write = { preHandler: requirePerm('product.write') };

  app.get('/api/categories', async () => db.select().from(categories).orderBy(categories.nameEn).all());

  app.post('/api/categories', write, async (req) => {
    const created = db.insert(categories).values(categoryInput.parse(req.body)).returning().get();
    logActivity(db, actorOf(req), 'category.create', created);
    return created;
  });

  app.put('/api/categories/:id', write, async (req) => {
    const { id } = idParam.parse(req.params);
    const updated = db.update(categories).set(categoryInput.parse(req.body)).where(eq(categories.id, id)).returning().get();
    if (!updated) throw notFound('Category');
    return updated;
  });

  app.get('/api/products', async (req) => hideCost(listProducts(db), can(auth(req).role, 'cost.view')));

  app.get('/api/products/:id/movements', { preHandler: requirePerm('stock.adjust') }, async (req) => {
    const { id } = idParam.parse(req.params);
    return db
      .select({
        id: stockMovements.id,
        qty: stockMovements.qty,
        type: stockMovements.type,
        refId: stockMovements.refId,
        createdAt: stockMovements.createdAt,
        userName: users.name,
      })
      .from(stockMovements)
      .leftJoin(users, eq(users.id, stockMovements.userId))
      .where(eq(stockMovements.productId, id))
      .orderBy(desc(stockMovements.id))
      .limit(200)
      .all();
  });

  app.post('/api/products', write, async (req) => {
    const body = productInput.extend({ openingStock: z.number().min(0).default(0) }).parse(req.body);
    const { openingStock, ...input } = body;
    const actor = actorOf(req);
    const created = transaction(sqlite, () => {
      const p = createProduct(db, input, openingStock, actor);
      logActivity(db, actor, 'product.create', { id: p.id, code: p.code, name: p.nameEn, openingStock });
      return p;
    });
    return created;
  });

  app.put('/api/products/:id', write, async (req) => {
    const { id } = idParam.parse(req.params);
    const input = productInput.partial().parse(req.body);
    const actor = actorOf(req);
    return transaction(sqlite, () => {
      const { before, after } = updateProduct(db, id, input);
      const priceChanges = PRICE_FIELDS.filter((f) => input[f] !== undefined && input[f] !== before[f]).map((f) => ({
        field: f,
        from: before[f],
        to: after[f],
      }));
      logActivity(db, actor, priceChanges.length ? 'product.price_change' : 'product.update', { id, code: after.code, priceChanges });
      return after;
    });
  });

  app.post('/api/products/price-update', write, async (req) => {
    const { brand, pct, fields } = priceUpdateInput.parse(req.body);
    const actor = actorOf(req);
    return transaction(sqlite, () => {
      const rows = db
        .select()
        .from(products)
        .where(sql`lower(${products.brand}) = lower(${brand})`)
        .all();
      for (const p of rows) {
        const set = Object.fromEntries(fields.map((f) => [f, adjustPrice(p[f], pct)]));
        db.update(products)
          .set({ ...set, updatedAt: Date.now() })
          .where(eq(products.id, p.id))
          .run();
      }
      logActivity(db, actor, 'product.price_update_brand', { brand, pct, fields, count: rows.length });
      return { updated: rows.length };
    });
  });
}
