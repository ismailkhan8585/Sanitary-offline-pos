import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../db';
import { challanItems, challans, customers, paymentMethods, products, sales } from '../db/schema';
import { actorOf, requirePerm } from '../lib/auth';
import { logActivity, type Actor } from '../lib/activity';
import { badRequest, notFound } from '../lib/errors';
import { transaction } from '../lib/tx';
import { moveStock } from '../lib/stock';
import { nextNumber, pad5 } from '../lib/sequence';
import { prepareSale, writeSale } from './sales/service';

const outItem = z.object({ productId: z.number().int(), qty: z.number().positive(), rate: z.number().int().min(0) });
const createInput = z.object({
  customerId: z.number().int(),
  siteName: z.string().trim().max(120).default(''),
  /** Cash taken in advance (paisa). */
  advance: z.number().int().min(0).default(0),
  items: z.array(outItem).min(1),
});
const addInput = z.object({ items: z.array(outItem).min(1) });
const returnInput = z.object({ items: z.array(z.object({ productId: z.number().int(), qty: z.number().positive() })).min(1) });
const closeInput = z.object({
  billDiscount: z.number().int().min(0).default(0),
  paid: z.number().int().min(0).default(0),
  paymentMethod: z.enum(paymentMethods).default('cash'),
});
const idParam = z.object({ id: z.coerce.number().int() });

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function openChallan(db: DB, id: number) {
  const c = db.select().from(challans).where(eq(challans.id, id)).get();
  if (!c) throw notFound('Challan');
  if (c.status !== 'open') throw badRequest('CHALLAN_CLOSED', 'This challan is already closed.');
  return c;
}

/** Sends goods to the site (quantities in base units). Merges into existing lines of the same product. */
function sendGoods(db: DB, challanId: number, items: z.infer<typeof outItem>[], actor: Actor) {
  const ids = [...new Set(items.map((i) => i.productId))];
  const found = db.select({ id: products.id }).from(products).where(inArray(products.id, ids)).all();
  if (found.length !== ids.length) throw notFound('Product');
  for (const item of items) {
    const line = db
      .select()
      .from(challanItems)
      .where(and(eq(challanItems.challanId, challanId), eq(challanItems.productId, item.productId)))
      .get();
    if (line) {
      db.update(challanItems)
        .set({ qtyOut: round3(line.qtyOut + item.qty), rate: item.rate })
        .where(eq(challanItems.id, line.id))
        .run();
    } else {
      db.insert(challanItems).values({ challanId, productId: item.productId, qtyOut: item.qty, rate: item.rate }).run();
    }
    moveStock(db, { productId: item.productId, qty: -item.qty, type: 'challan_out', refId: challanId, ...actor });
  }
}

export function challanDetail(db: DB, id: number) {
  const row = db
    .select({ c: challans, customerName: customers.name, customerPhone: customers.phone, finalBillNo: sales.billNo })
    .from(challans)
    .innerJoin(customers, eq(customers.id, challans.customerId))
    .leftJoin(sales, eq(sales.id, challans.finalSaleId))
    .where(eq(challans.id, id))
    .get();
  if (!row) throw notFound('Challan');
  const items = db
    .select({
      productId: challanItems.productId,
      nameEn: products.nameEn,
      nameUr: products.nameUr,
      unit: products.unit,
      qtyOut: challanItems.qtyOut,
      qtyReturned: challanItems.qtyReturned,
      rate: challanItems.rate,
    })
    .from(challanItems)
    .innerJoin(products, eq(products.id, challanItems.productId))
    .where(eq(challanItems.challanId, id))
    .all()
    .map((i) => ({ ...i, atSite: round3(i.qtyOut - i.qtyReturned), value: Math.round((i.qtyOut - i.qtyReturned) * i.rate) }));
  return { ...row.c, customerName: row.customerName, customerPhone: row.customerPhone, finalBillNo: row.finalBillNo, items };
}

export function challanRoutes(app: FastifyInstance): void {
  const { db, sqlite } = app.ctx;
  const guard = { preHandler: requirePerm('challan') };

  app.get('/api/challans', guard, async () => {
    const list = db
      .select({ c: challans, customerName: customers.name })
      .from(challans)
      .innerJoin(customers, eq(customers.id, challans.customerId))
      .orderBy(desc(challans.id))
      .limit(300)
      .all();
    const lines = list.length
      ? db
          .select()
          .from(challanItems)
          .where(inArray(challanItems.challanId, list.map((l) => l.c.id)))
          .all()
      : [];
    return list.map(({ c, customerName }) => {
      const mine = lines.filter((l) => l.challanId === c.id);
      return { ...c, customerName, itemCount: mine.length, valueAtSite: mine.reduce((s, l) => s + Math.round((l.qtyOut - l.qtyReturned) * l.rate), 0) };
    });
  });

  app.get('/api/challans/:id', guard, async (req) => challanDetail(db, idParam.parse(req.params).id));

  app.post('/api/challans', guard, async (req) => {
    const input = createInput.parse(req.body);
    const actor = actorOf(req);
    const id = transaction(sqlite, () => {
      if (!db.select({ id: customers.id }).from(customers).where(eq(customers.id, input.customerId)).get()) throw notFound('Customer');
      const c = db
        .insert(challans)
        .values({ challanNo: `CH-${pad5(nextNumber(db, 'CH'))}`, customerId: input.customerId, siteName: input.siteName, advance: input.advance })
        .returning()
        .get();
      sendGoods(db, c.id, input.items, actor);
      logActivity(db, actor, 'challan.create', { id: c.id, challanNo: c.challanNo, advance: input.advance, items: input.items.length });
      return c.id;
    });
    return challanDetail(db, id);
  });

  app.post('/api/challans/:id/items', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const { items } = addInput.parse(req.body);
    const actor = actorOf(req);
    transaction(sqlite, () => {
      openChallan(db, id);
      sendGoods(db, id, items, actor);
      logActivity(db, actor, 'challan.add_items', { id, items });
    });
    return challanDetail(db, id);
  });

  app.post('/api/challans/:id/return', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const { items } = returnInput.parse(req.body);
    const actor = actorOf(req);
    transaction(sqlite, () => {
      openChallan(db, id);
      for (const item of items) {
        const line = db
          .select()
          .from(challanItems)
          .where(and(eq(challanItems.challanId, id), eq(challanItems.productId, item.productId)))
          .get();
        const atSite = line ? round3(line.qtyOut - line.qtyReturned) : 0;
        if (!line || item.qty > atSite + 1e-9) throw badRequest('RETURN_TOO_MUCH', `Only ${atSite} is at the site.`, { name: '', qty: atSite });
        db.update(challanItems)
          .set({ qtyReturned: round3(line.qtyReturned + item.qty) })
          .where(eq(challanItems.id, line.id))
          .run();
        moveStock(db, { productId: item.productId, qty: item.qty, type: 'challan_return', refId: id, ...actor });
      }
      logActivity(db, actor, 'challan.return', { id, items });
    });
    return challanDetail(db, id);
  });

  /** One final bill for the goods used at the site, minus the advance. Stock already left with the challan. */
  app.post('/api/challans/:id/close', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const input = closeInput.parse(req.body);
    const actor = actorOf(req);
    transaction(sqlite, () => {
      const c = openChallan(db, id);
      const used = db
        .select()
        .from(challanItems)
        .where(eq(challanItems.challanId, id))
        .all()
        .map((l) => ({ productId: l.productId, qty: round3(l.qtyOut - l.qtyReturned), rate: l.rate }))
        .filter((l) => l.qty > 0);
      let finalSaleId: number | null = null;
      if (used.length) {
        const productUnits = new Map(
          db
            .select({ id: products.id, unit: products.unit })
            .from(products)
            .where(inArray(products.id, used.map((u) => u.productId)))
            .all()
            .map((p) => [p.id, p.unit]),
        );
        const saleInput = {
          status: 'done' as const,
          customerId: c.customerId,
          plumberId: null,
          priceTier: 'retail' as const,
          items: used.map((u) => ({ productId: u.productId, qty: u.qty, unit: productUnits.get(u.productId)!, rate: u.rate, discount: 0 })),
          billDiscount: input.billDiscount,
          paymentMethod: input.paymentMethod,
          paid: input.paid,
        };
        const prepared = prepareSale(db, saleInput);
        const credit = Math.min(c.advance, prepared.totals.total);
        finalSaleId = writeSale(db, saleInput, prepared, actor, { creditApplied: credit, skipStock: true }).id;
      }
      db.update(challans).set({ status: 'closed', finalSaleId }).where(eq(challans.id, id)).run();
      logActivity(db, actor, 'challan.close', { id, challanNo: c.challanNo, finalSaleId });
    });
    return challanDetail(db, id);
  });
}
