import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../db';
import { customers, products, refundTypes, returnItems, returns, saleItems, sales, users } from '../db/schema';
import { actorOf, auth, requirePerm } from '../lib/auth';
import { checkApproval } from '../lib/approval';
import { logActivity, type Actor } from '../lib/activity';
import { badRequest, notFound } from '../lib/errors';
import { transaction } from '../lib/tx';
import { moveStock } from '../lib/stock';
import { customerBalance } from '../lib/ledger';
import { toBaseQty } from '../shared/units';

export interface ReturnableItem {
  productId: number;
  nameEn: string;
  nameUr: string;
  unit: string;
  sold: number;
  returned: number;
  returnable: number;
  /** Paisa per base unit actually paid (after line/bill discount, with tax). */
  rate: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

interface SoldLine {
  saleId: number;
  createdAt: number;
  productId: number;
  baseQty: number;
  rate: number;
}

/** Each sold line of finished bills with the price paid per base unit. */
function soldLines(db: DB, where: SQL): SoldLine[] {
  const rows = db
    .select({
      saleId: sales.id,
      createdAt: sales.createdAt,
      productId: saleItems.productId,
      qty: saleItems.qty,
      packQty: saleItems.packQty,
      lineTotal: saleItems.total,
      subtotal: sales.subtotal,
      total: sales.total,
    })
    .from(saleItems)
    .innerJoin(sales, eq(sales.id, saleItems.saleId))
    .where(and(eq(sales.status, 'done'), where))
    .all();
  return rows.map((r) => {
    const baseQty = toBaseQty(r.qty, r.packQty);
    const factor = r.subtotal > 0 ? r.total / r.subtotal : 1;
    return { saleId: r.saleId, createdAt: r.createdAt, productId: r.productId, baseQty, rate: baseQty > 0 ? Math.round((r.lineTotal * factor) / baseQty) : 0 };
  });
}

function returnedQty(db: DB, where: SQL): Map<number, number> {
  const rows = db
    .select({ productId: returnItems.productId, qty: sql<number>`sum(${returnItems.qty})` })
    .from(returnItems)
    .innerJoin(returns, eq(returns.id, returnItems.returnId))
    .where(where)
    .groupBy(returnItems.productId)
    .all();
  return new Map(rows.map((r) => [r.productId, r.qty]));
}

/** What can still come back: per bill, or across all bills of a customer (latest price). */
export function returnableItems(db: DB, scope: { saleId: number } | { customerId: number }): ReturnableItem[] {
  const lines =
    'saleId' in scope ? soldLines(db, eq(sales.id, scope.saleId)) : soldLines(db, eq(sales.customerId, scope.customerId));
  const returned =
    'saleId' in scope ? returnedQty(db, eq(returns.saleId, scope.saleId)) : returnedQty(db, eq(returns.customerId, scope.customerId));
  const byProduct = new Map<number, { sold: number; rate: number; latest: number }>();
  for (const l of lines) {
    const cur = byProduct.get(l.productId) ?? { sold: 0, rate: l.rate, latest: 0 };
    cur.sold += l.baseQty;
    if (l.createdAt >= cur.latest) {
      cur.rate = l.rate;
      cur.latest = l.createdAt;
    }
    byProduct.set(l.productId, cur);
  }
  if (byProduct.size === 0) return [];
  const names = new Map(
    db
      .select({ id: products.id, nameEn: products.nameEn, nameUr: products.nameUr, unit: products.unit })
      .from(products)
      .all()
      .map((p) => [p.id, p]),
  );
  return [...byProduct.entries()].map(([productId, v]) => {
    const r = returned.get(productId) ?? 0;
    const p = names.get(productId)!;
    return { productId, nameEn: p.nameEn, nameUr: p.nameUr, unit: p.unit, sold: round3(v.sold), returned: round3(r), returnable: round3(Math.max(0, v.sold - r)), rate: v.rate };
  });
}

export const returnInput = z
  .object({
    saleId: z.number().int().optional(),
    customerId: z.number().int().optional(),
    items: z.array(z.object({ productId: z.number().int(), qty: z.number().positive(), condition: z.enum(['good', 'damaged']) })).min(1),
    refundType: z.enum(refundTypes),
    reason: z.string().trim().max(200).default(''),
    restockCharge: z.number().int().min(0).default(0),
    adminPin: z.string().max(8).optional(),
  })
  .refine((v) => v.saleId !== undefined || v.customerId !== undefined, 'Choose a bill or a customer');
export type ReturnInput = z.infer<typeof returnInput>;

/** Money given back for a return. Used for the cashier limit check before writing. */
export function previewRefund(db: DB, input: ReturnInput) {
  const sale = input.saleId ? db.select().from(sales).where(eq(sales.id, input.saleId)).get() : undefined;
  if (input.saleId && !sale) throw notFound('Bill');
  if (sale && sale.status !== 'done') throw badRequest('BILL_NOT_DONE', 'Only finished bills can have returns.');
  const customerId = sale ? sale.customerId : (input.customerId ?? null);
  const available = returnableItems(db, sale ? { saleId: sale.id } : { customerId: customerId! });
  const lines = input.items.map((item) => {
    const a = available.find((x) => x.productId === item.productId);
    if (!a || item.qty > a.returnable + 1e-9) {
      throw badRequest('RETURN_TOO_MUCH', `Only ${a?.returnable ?? 0} of ${a?.nameEn ?? 'this item'} can be returned.`, { name: a?.nameEn ?? '', qty: a?.returnable ?? 0 });
    }
    return { ...item, rate: a.rate, amount: Math.round(item.qty * a.rate) };
  });
  const total = lines.reduce((s, l) => s + l.amount, 0);
  if (input.restockCharge > total) throw badRequest('RESTOCK_TOO_BIG', 'Restock charge is more than the return value.');
  if (input.refundType === 'khata' && !customerId) throw badRequest('CUSTOMER_REQUIRED', 'Khata refund needs a customer. Use cash or exchange.');
  return { sale, customerId, lines, total, refund: total - input.restockCharge };
}

export function writeReturn(db: DB, input: ReturnInput, actor: Actor) {
  const { sale, customerId, lines, total, refund } = previewRefund(db, input);
  const ret = db
    .insert(returns)
    .values({ saleId: sale?.id ?? null, customerId, total, refundType: input.refundType, reason: input.reason, restockCharge: input.restockCharge, userId: actor.userId! })
    .returning()
    .get();
  for (const l of lines) {
    db.insert(returnItems).values({ returnId: ret.id, productId: l.productId, qty: l.qty, rate: l.rate, condition: l.condition }).run();
    moveStock(db, { productId: l.productId, qty: l.qty, type: 'sale_return', refId: ret.id, ...actor });
    if (l.condition === 'damaged') moveStock(db, { productId: l.productId, qty: -l.qty, type: 'damage', refId: ret.id, ...actor });
  }
  reduceCommission(db, sale?.id, customerId, lines);
  logActivity(db, actor, 'return.create', { id: ret.id, saleId: sale?.id, customerId, total, refund, refundType: input.refundType, reason: input.reason });
  return { ...ret, refund, customerBalance: customerId ? customerBalance(db, customerId) : null };
}

/** Takes back the plumber's share of returned goods from the bill(s) they were sold on. */
function reduceCommission(db: DB, saleId: number | undefined, customerId: number | null, lines: { productId: number; amount: number }[]) {
  for (const l of lines) {
    const target = saleId
      ? db.select().from(sales).where(eq(sales.id, saleId)).get()
      : customerId
        ? db
            .select({ s: sales })
            .from(sales)
            .innerJoin(saleItems, eq(saleItems.saleId, sales.id))
            .where(and(eq(sales.customerId, customerId), eq(sales.status, 'done'), eq(saleItems.productId, l.productId), sql`${sales.commission} > 0`))
            .orderBy(desc(sales.id))
            .get()?.s
        : undefined;
    if (!target || target.commission <= 0 || target.total <= 0) continue;
    const cut = Math.min(target.commission, Math.round((target.commission * l.amount) / target.total));
    db.update(sales)
      .set({ commission: target.commission - cut })
      .where(eq(sales.id, target.id))
      .run();
  }
}

const returnableQuery = z.object({
  billNo: z.string().trim().optional(),
  saleId: z.coerce.number().int().optional(),
  customerId: z.coerce.number().int().optional(),
});
const listQuery = z.object({ from: z.coerce.number().int().optional(), to: z.coerce.number().int().optional() });

export function returnRoutes(app: FastifyInstance): void {
  const { db, sqlite } = app.ctx;
  const guard = { preHandler: requirePerm('return') };

  app.get('/api/returns/returnable', guard, async (req) => {
    const q = returnableQuery.parse(req.query);
    if (q.billNo || q.saleId) {
      const sale = q.saleId
        ? db.select().from(sales).where(eq(sales.id, q.saleId)).get()
        : db.select().from(sales).where(eq(sales.billNo, q.billNo!.toUpperCase())).get();
      if (!sale) throw notFound('Bill');
      if (sale.status !== 'done') throw badRequest('BILL_NOT_DONE', 'Only finished bills can have returns.');
      const customer = sale.customerId ? db.select().from(customers).where(eq(customers.id, sale.customerId)).get() : undefined;
      return { sale: { id: sale.id, billNo: sale.billNo, createdAt: sale.createdAt, total: sale.total }, customer: customer ?? null, items: returnableItems(db, { saleId: sale.id }) };
    }
    if (q.customerId) {
      const customer = db.select().from(customers).where(eq(customers.id, q.customerId)).get();
      if (!customer) throw notFound('Customer');
      return { sale: null, customer, items: returnableItems(db, { customerId: customer.id }).filter((i) => i.returnable > 0) };
    }
    throw badRequest('VALIDATION', 'Give a bill number or a customer.');
  });

  app.post('/api/returns', guard, async (req) => {
    const input = returnInput.parse(req.body);
    const actor = actorOf(req);
    const user = auth(req);
    return transaction(sqlite, () => {
      const { refund } = previewRefund(db, input);
      const over = refund > user.returnLimit ? [{ action: 'return_limit' as const, details: { refund, limit: user.returnLimit } }] : [];
      checkApproval(db, user, over, input.adminPin);
      return writeReturn(db, input, actor);
    });
  });

  app.get('/api/returns', guard, async (req) => {
    const q = listQuery.parse(req.query);
    return db
      .select({
        id: returns.id,
        total: returns.total,
        restockCharge: returns.restockCharge,
        refundType: returns.refundType,
        reason: returns.reason,
        createdAt: returns.createdAt,
        billNo: sales.billNo,
        customerName: customers.name,
        userName: users.name,
      })
      .from(returns)
      .leftJoin(sales, eq(sales.id, returns.saleId))
      .leftJoin(customers, eq(customers.id, returns.customerId))
      .leftJoin(users, eq(users.id, returns.userId))
      .where(and(q.from ? gte(returns.createdAt, q.from) : undefined, q.to ? lte(returns.createdAt, q.to) : undefined))
      .orderBy(desc(returns.id))
      .limit(300)
      .all();
  });
}
