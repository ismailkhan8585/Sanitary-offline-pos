import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db';
import {
  customers,
  devices,
  paymentMethods,
  plumbers,
  priceTiers,
  products,
  returns,
  saleItems,
  sales,
  users,
} from '../../db/schema';
import { badRequest, notFound } from '../../lib/errors';
import { moveStock } from '../../lib/stock';
import { nextNumber, pad5 } from '../../lib/sequence';
import { getSetting } from '../../lib/settings';
import { customerBalance } from '../../lib/ledger';
import { logActivity, type Actor } from '../../lib/activity';
import { billTotals, commissionFor, lineTotal, type Totals } from '../../shared/billing';
import { toBaseQty } from '../../shared/units';

export const saleItemInput = z.object({
  productId: z.number().int(),
  qty: z.number().positive(),
  unit: z.string().min(1),
  rate: z.number().int().min(0),
  discount: z.number().int().min(0).default(0),
});

export const saleInput = z.object({
  status: z.enum(['done', 'quotation', 'held']).default('done'),
  customerId: z.number().int().nullable().default(null),
  plumberId: z.number().int().nullable().default(null),
  priceTier: z.enum(priceTiers).default('retail'),
  items: z.array(saleItemInput).min(1),
  billDiscount: z.number().int().min(0).default(0),
  paymentMethod: z.enum(paymentMethods).default('cash'),
  /** Money received now (paisa), not more than the bill total. */
  paid: z.number().int().min(0).default(0),
  fromHeldId: z.number().int().optional(),
  /** An "exchange" return whose value pays part of this bill. */
  exchangeReturnId: z.number().int().optional(),
  /** Admin PIN typed on the cashier's screen when a rule needs approval. */
  adminPin: z.string().max(8).optional(),
});
export type SaleInput = z.infer<typeof saleInput>;

/** Value of an exchange return that has not been used on another (live) bill yet. */
export function exchangeCredit(db: DB, returnId: number): number {
  const ret = db.select().from(returns).where(eq(returns.id, returnId)).get();
  if (!ret || ret.refundType !== 'exchange') throw notFound('Exchange return');
  const used = db
    .select({ id: sales.id })
    .from(sales)
    .where(and(eq(sales.exchangeReturnId, returnId), sql`${sales.status} != 'cancelled'`))
    .get();
  if (used) throw badRequest('EXCHANGE_USED', 'This exchange was already used on another bill.');
  return ret.total - ret.restockCharge;
}

export interface PreparedLine {
  productId: number;
  name: string;
  qty: number;
  unit: string;
  packQty: number;
  baseQty: number;
  rate: number;
  cost: number;
  discount: number;
  total: number;
  /** Product data the approval rules need. */
  stock: number;
  costPerUnit: number;
  listRate: number;
}

export interface PreparedSale {
  lines: PreparedLine[];
  totals: Totals;
  commission: number;
}

/** Loads products, fixes units/pack sizes from the catalogue and computes totals. Does not write. */
export function prepareSale(db: DB, input: Pick<SaleInput, 'items' | 'billDiscount' | 'plumberId' | 'priceTier'>, extraCredit = 0): PreparedSale {
  const ids = [...new Set(input.items.map((i) => i.productId))];
  const rows = db
    .select({ p: products, stock: sql<number>`coalesce((SELECT qty FROM product_stock WHERE product_id = ${products.id}), 0)` })
    .from(products)
    .where(inArray(products.id, ids))
    .all();
  const byId = new Map(rows.map((r) => [r.p.id, r]));
  const lines = input.items.map((item): PreparedLine => {
    const row = byId.get(item.productId);
    if (!row || !row.p.active) throw notFound('Product');
    const { p } = row;
    const isPack = p.packUnit !== null && item.unit === p.packUnit;
    if (!isPack && item.unit !== p.unit) throw badRequest('BAD_UNIT', `${p.nameEn} is not sold by ${item.unit}.`, { name: p.nameEn });
    const packQty = isPack ? p.packQty : 1;
    const tierPrice = input.priceTier === 'plumber' ? p.plumberPrice : input.priceTier === 'wholesale' ? p.wholesalePrice : p.retailPrice;
    if (item.discount > Math.round(item.qty * item.rate)) throw badRequest('BAD_DISCOUNT', 'Discount is more than the line amount.');
    return {
      productId: p.id,
      name: p.nameEn,
      qty: item.qty,
      unit: item.unit,
      packQty,
      baseQty: toBaseQty(item.qty, packQty),
      rate: item.rate,
      cost: Math.round(p.costPrice * packQty),
      discount: item.discount,
      total: lineTotal(item),
      stock: row.stock,
      costPerUnit: Math.round(p.costPrice * packQty),
      listRate: Math.round((tierPrice || p.retailPrice) * packQty),
    };
  });
  const taxPct = Number(getSetting(db, 'tax_pct') ?? '0');
  const totals = billTotals(lines, input.billDiscount, taxPct);
  if (extraCredit > totals.total) throw badRequest('CREDIT_TOO_BIG', 'Advance/exchange credit is more than the bill.');
  const plumber = input.plumberId ? db.select().from(plumbers).where(eq(plumbers.id, input.plumberId)).get() : undefined;
  if (input.plumberId && !plumber) throw notFound('Plumber');
  return { lines, totals, commission: plumber ? commissionFor(totals, plumber.commissionPct) : 0 };
}

export interface WriteSaleOptions {
  /** Credit (paisa) already settled by a challan advance or an exchange return. */
  creditApplied?: number;
  exchangeReturnId?: number | null;
  /** Challan final bills: goods already left stock when the challan went out. */
  skipStock?: boolean;
  /** Emergency bills keep the number given offline. */
  billNo?: string;
  createdAt?: number;
}

/** Writes a sale with items and stock movements. Must run inside a transaction. */
export function writeSale(db: DB, input: SaleInput, prepared: PreparedSale, actor: Actor, opts: WriteSaleOptions = {}) {
  const device = actor.deviceId ? db.select().from(devices).where(eq(devices.id, actor.deviceId)).get() : undefined;
  if (!device) throw badRequest('NO_COUNTER', 'This device is not set up as a counter. Ask Admin to set it up.');
  if (input.customerId && !db.select({ id: customers.id }).from(customers).where(eq(customers.id, input.customerId)).get()) {
    throw notFound('Customer');
  }
  const { totals } = prepared;
  const credit = opts.creditApplied ?? 0;
  const paid = Math.min(input.paid, totals.total - credit);
  const due = input.status === 'done' ? totals.total - credit - paid : 0;
  if (due > 0 && !input.customerId) throw badRequest('CUSTOMER_REQUIRED', 'Choose a customer for udhaar (credit) bills.');

  const billNo = opts.billNo ?? makeBillNo(db, input.status, device.billPrefix);
  const sale = db
    .insert(sales)
    .values({
      billNo,
      deviceId: device.id,
      userId: actor.userId!,
      customerId: input.customerId,
      plumberId: input.plumberId,
      priceTier: input.priceTier,
      subtotal: totals.subtotal,
      discount: totals.discount,
      tax: totals.tax,
      total: totals.total,
      paid: input.status === 'done' ? paid : 0,
      due,
      creditApplied: credit,
      exchangeReturnId: opts.exchangeReturnId ?? null,
      paymentMethod: due > 0 && paid === 0 ? 'credit' : input.paymentMethod,
      commission: input.status === 'done' ? prepared.commission : 0,
      status: input.status,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning()
    .get();

  for (const l of prepared.lines) {
    db.insert(saleItems)
      .values({ saleId: sale.id, productId: l.productId, qty: l.qty, unit: l.unit, packQty: l.packQty, rate: l.rate, cost: l.cost, discount: l.discount, total: l.total })
      .run();
    if (input.status === 'done' && !opts.skipStock) {
      moveStock(db, { productId: l.productId, qty: -l.baseQty, type: 'sale', refId: sale.id, ...actor });
    }
  }

  if (input.fromHeldId) {
    const held = db.select().from(sales).where(eq(sales.id, input.fromHeldId)).get();
    if (held?.status === 'held') {
      db.update(sales).set({ status: 'cancelled', cancelReason: `Recalled as ${billNo}` }).where(eq(sales.id, held.id)).run();
    }
  }
  logActivity(db, actor, `sale.${input.status}`, { id: sale.id, billNo, total: sale.total, paid: sale.paid, due: sale.due });
  return sale;
}

function makeBillNo(db: DB, status: SaleInput['status'], prefix: string): string {
  const series = status === 'quotation' ? `Q${prefix}` : status === 'held' ? `H${prefix}` : prefix;
  return `${series}-${pad5(nextNumber(db, series))}`;
}

/** Cancels a finished bill and puts its goods back in stock. */
export function cancelSale(db: DB, id: number, reason: string, actor: Actor) {
  const sale = db.select().from(sales).where(eq(sales.id, id)).get();
  if (!sale) throw notFound('Bill');
  if (sale.status === 'cancelled') throw badRequest('ALREADY_CANCELLED', 'This bill is already cancelled.');
  if (db.select({ id: returns.id }).from(returns).where(eq(returns.saleId, id)).get()) {
    throw badRequest('HAS_RETURNS', 'Goods from this bill were returned. Cancel is not possible.');
  }
  if (sale.status === 'done') {
    for (const item of db.select().from(saleItems).where(eq(saleItems.saleId, id)).all()) {
      moveStock(db, { productId: item.productId, qty: toBaseQty(item.qty, item.packQty), type: 'sale', refId: id, ...actor });
    }
  }
  db.update(sales).set({ status: 'cancelled', cancelReason: reason }).where(eq(sales.id, id)).run();
  logActivity(db, actor, 'sale.cancel', { id, billNo: sale.billNo, total: sale.total, reason });
}

/** Bill with lines and names, ready for the receipt. */
export function saleDetail(db: DB, id: number) {
  const sale = db
    .select({
      sale: sales,
      customerName: customers.name,
      customerPhone: customers.phone,
      plumberName: plumbers.name,
      userName: users.name,
      deviceName: devices.name,
    })
    .from(sales)
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .leftJoin(plumbers, eq(plumbers.id, sales.plumberId))
    .leftJoin(users, eq(users.id, sales.userId))
    .leftJoin(devices, eq(devices.id, sales.deviceId))
    .where(eq(sales.id, id))
    .get();
  if (!sale) throw notFound('Bill');
  const items = db
    .select({
      id: saleItems.id,
      productId: saleItems.productId,
      code: products.code,
      nameEn: products.nameEn,
      nameUr: products.nameUr,
      qty: saleItems.qty,
      unit: saleItems.unit,
      packQty: saleItems.packQty,
      rate: saleItems.rate,
      cost: saleItems.cost,
      discount: saleItems.discount,
      total: saleItems.total,
    })
    .from(saleItems)
    .innerJoin(products, eq(products.id, saleItems.productId))
    .where(eq(saleItems.saleId, id))
    .all();
  const { sale: s, ...names } = sale;
  return { ...s, ...names, items, customerBalance: s.customerId ? customerBalance(db, s.customerId) : null };
}

export type SaleDetail = ReturnType<typeof saleDetail>;

/** Removes cost from a bill for users who may not see it. */
export function hideSaleCost(detail: SaleDetail, canSeeCost: boolean) {
  if (canSeeCost) return detail;
  return { ...detail, items: detail.items.map(({ cost: _hidden, ...rest }) => rest) };
}

export function heldSales(db: DB, deviceId: number | null) {
  return db
    .select({ id: sales.id, billNo: sales.billNo, total: sales.total, createdAt: sales.createdAt, customerName: customers.name, status: sales.status })
    .from(sales)
    .leftJoin(customers, eq(customers.id, sales.customerId))
    .where(and(inArray(sales.status, ['held', 'quotation']), deviceId ? sql`(${sales.status} = 'quotation' OR ${sales.deviceId} = ${deviceId})` : undefined))
    .orderBy(sql`${sales.id} DESC`)
    .limit(100)
    .all();
}
