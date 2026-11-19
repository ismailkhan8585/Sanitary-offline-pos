import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../db';
import { paymentMethods, products, purchaseItems, purchases, suppliers, users } from '../db/schema';
import { actorOf, requirePerm } from '../lib/auth';
import { logActivity, type Actor } from '../lib/activity';
import { badRequest, notFound } from '../lib/errors';
import { transaction } from '../lib/tx';
import { currentStock, moveStock } from '../lib/stock';
import { supplierBalance } from '../lib/ledger';
import { toBaseQty } from '../shared/units';

const itemInput = z.object({
  productId: z.number().int(),
  /** Unit typed on screen (base or pack); stored in base units. */
  unit: z.string().min(1),
  qty: z.number().positive(),
  freeQty: z.number().min(0).default(0),
  /** Paisa per `unit`. */
  cost: z.number().int().min(0),
});

export const purchaseInput = z.object({
  supplierId: z.number().int(),
  invoiceNo: z.string().trim().max(40).default(''),
  items: z.array(itemInput).min(1),
  /** For a purchase: money paid to the supplier now. For a return: money the supplier gave back. */
  paid: z.number().int().min(0).default(0),
  paymentMethod: z.enum(paymentMethods).default('cash'),
  isReturn: z.boolean().default(false),
  /** Set product cost price from this invoice (purchases only). */
  updateCost: z.boolean().default(true),
});
export type PurchaseInput = z.infer<typeof purchaseInput>;

/** Cost per base unit after spreading bonus (free) units over the paid ones. */
export function effectiveUnitCost(cost: number, qty: number, freeQty: number): number {
  return qty + freeQty > 0 ? Math.round((cost * qty) / (qty + freeQty)) : cost;
}

export function writePurchase(db: DB, input: PurchaseInput, actor: Actor) {
  if (!db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, input.supplierId)).get()) throw notFound('Supplier');
  const ids = [...new Set(input.items.map((i) => i.productId))];
  const byId = new Map(db.select().from(products).where(inArray(products.id, ids)).all().map((p) => [p.id, p]));

  const lines = input.items.map((item) => {
    const p = byId.get(item.productId);
    if (!p) throw notFound('Product');
    const isPack = p.packUnit !== null && item.unit === p.packUnit;
    if (!isPack && item.unit !== p.unit) throw badRequest('BAD_UNIT', `${p.nameEn} is not counted in ${item.unit}.`, { name: p.nameEn });
    const pack = isPack ? p.packQty : 1;
    return {
      product: p,
      qty: toBaseQty(item.qty, pack),
      freeQty: input.isReturn ? 0 : toBaseQty(item.freeQty, pack),
      cost: Math.round(item.cost / pack),
      amount: Math.round(item.qty * item.cost),
    };
  });
  const total = lines.reduce((s, l) => s + l.amount, 0);
  if (input.paid > total) throw badRequest('PAID_TOO_MUCH', 'Paid amount is more than the invoice total.');

  const purchase = db
    .insert(purchases)
    .values({
      supplierId: input.supplierId,
      invoiceNo: input.invoiceNo,
      total,
      paid: input.paid,
      due: total - input.paid,
      paymentMethod: input.paid === 0 ? 'credit' : input.paymentMethod,
      isReturn: input.isReturn,
      userId: actor.userId!,
    })
    .returning()
    .get();

  const costChanges: { code: string; from: number; to: number }[] = [];
  for (const l of lines) {
    db.insert(purchaseItems).values({ purchaseId: purchase.id, productId: l.product.id, qty: l.qty, freeQty: l.freeQty, cost: l.cost }).run();
    if (input.isReturn) {
      const stock = currentStock(db, l.product.id);
      if (l.qty > stock) throw badRequest('NOT_ENOUGH_STOCK', `Only ${stock} of ${l.product.nameEn} in stock.`, { name: l.product.nameEn });
      moveStock(db, { productId: l.product.id, qty: -l.qty, type: 'purchase_return', refId: purchase.id, ...actor });
    } else {
      moveStock(db, { productId: l.product.id, qty: l.qty + l.freeQty, type: 'purchase', refId: purchase.id, ...actor });
      const newCost = effectiveUnitCost(l.cost, l.qty, l.freeQty);
      if (input.updateCost && newCost !== l.product.costPrice) {
        db.update(products).set({ costPrice: newCost, updatedAt: Date.now() }).where(eq(products.id, l.product.id)).run();
        costChanges.push({ code: l.product.code, from: l.product.costPrice, to: newCost });
      }
    }
  }
  logActivity(db, actor, input.isReturn ? 'purchase.return' : 'purchase.create', {
    id: purchase.id,
    supplierId: input.supplierId,
    invoiceNo: input.invoiceNo,
    total,
    paid: input.paid,
    costChanges,
  });
  return purchase;
}

const listQuery = z.object({
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  supplierId: z.coerce.number().int().optional(),
});
const idParam = z.object({ id: z.coerce.number().int() });

export function purchaseRoutes(app: FastifyInstance): void {
  const { db, sqlite } = app.ctx;
  const guard = { preHandler: requirePerm('purchase') };

  app.post('/api/purchases', guard, async (req) => {
    const input = purchaseInput.parse(req.body);
    const purchase = transaction(sqlite, () => writePurchase(db, input, actorOf(req)));
    return { ...purchase, supplierBalance: supplierBalance(db, input.supplierId) };
  });

  app.get('/api/purchases', guard, async (req) => {
    const q = listQuery.parse(req.query);
    const where: (SQL | undefined)[] = [
      q.from ? gte(purchases.createdAt, q.from) : undefined,
      q.to ? lte(purchases.createdAt, q.to) : undefined,
      q.supplierId ? eq(purchases.supplierId, q.supplierId) : undefined,
    ];
    return db
      .select({
        id: purchases.id,
        invoiceNo: purchases.invoiceNo,
        total: purchases.total,
        paid: purchases.paid,
        due: purchases.due,
        paymentMethod: purchases.paymentMethod,
        isReturn: purchases.isReturn,
        createdAt: purchases.createdAt,
        supplierName: suppliers.name,
        userName: users.name,
      })
      .from(purchases)
      .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
      .leftJoin(users, eq(users.id, purchases.userId))
      .where(and(...where))
      .orderBy(desc(purchases.id))
      .limit(500)
      .all();
  });

  app.get('/api/purchases/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const purchase = db
      .select({ p: purchases, supplierName: suppliers.name })
      .from(purchases)
      .innerJoin(suppliers, eq(suppliers.id, purchases.supplierId))
      .where(eq(purchases.id, id))
      .get();
    if (!purchase) throw notFound('Purchase');
    const items = db
      .select({
        id: purchaseItems.id,
        productId: purchaseItems.productId,
        nameEn: products.nameEn,
        nameUr: products.nameUr,
        unit: products.unit,
        qty: purchaseItems.qty,
        freeQty: purchaseItems.freeQty,
        cost: purchaseItems.cost,
      })
      .from(purchaseItems)
      .innerJoin(products, eq(products.id, purchaseItems.productId))
      .where(eq(purchaseItems.purchaseId, id))
      .all();
    return { ...purchase.p, supplierName: purchase.supplierName, items };
  });
}
