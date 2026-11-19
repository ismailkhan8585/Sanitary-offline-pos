import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import type { DB } from '../db';
import { auth, requirePerm } from '../lib/auth';
import { allBalances } from '../lib/ledger';
import { addSheet, sendWorkbook } from '../lib/excel';
import { badRequest } from '../lib/errors';
import { can } from '../shared/permissions';

export type ColumnType = 'text' | 'money' | 'qty' | 'int' | 'date' | 'pct';
export interface ReportColumn {
  key: string;
  type: ColumnType;
}
export interface Report {
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
}

const query = z.object({
  from: z.coerce.number().int().default(() => Date.now() - 30 * 86_400_000),
  to: z.coerce.number().int().default(() => Date.now()),
  group: z.string().optional(),
  format: z.enum(['json', 'xlsx']).default('json'),
});
type Q = z.infer<typeof query>;

const cols = (spec: string): ReportColumn[] =>
  spec.split(' ').map((s) => {
    const [key, type = 'text'] = s.split(':');
    return { key, type: type as ColumnType };
  });

/** Profit of finished bills: total without tax minus the cost of what was sold. */
const SALE_PROFIT = sql`(s.total - s.tax - coalesce((SELECT sum(round(si.cost * si.qty)) FROM sale_items si WHERE si.sale_id = s.id), 0))`;

function periodFormat(group: string | undefined) {
  return group === 'month' ? '%Y-%m' : '%Y-%m-%d';
}

const reports: Record<string, (db: DB, q: Q) => Report> = {
  sales(db, q) {
    const fmt = periodFormat(q.group);
    const rows = db.all<Record<string, number | string>>(sql`
      SELECT strftime(${fmt}, s.created_at / 1000, 'unixepoch', 'localtime') AS period, count(*) AS bills,
             sum(s.subtotal) AS subtotal, sum(s.discount) AS discount, sum(s.tax) AS tax, sum(s.total) AS total,
             sum(s.paid) AS paid, sum(s.due) AS due, sum(${SALE_PROFIT}) AS profit
      FROM sales s WHERE s.status = 'done' AND s.created_at BETWEEN ${q.from} AND ${q.to}
      GROUP BY period ORDER BY period`);
    const rets = db.all<{ period: string; refunds: number; lostProfit: number }>(sql`
      SELECT strftime(${fmt}, r.created_at / 1000, 'unixepoch', 'localtime') AS period, sum(r.total - r.restock_charge) AS refunds,
             sum(r.total - r.restock_charge) - coalesce(sum((SELECT sum(round(ri.qty * p.cost_price)) FROM return_items ri JOIN products p ON p.id = ri.product_id WHERE ri.return_id = r.id)), 0) AS lostProfit
      FROM returns r WHERE r.created_at BETWEEN ${q.from} AND ${q.to} GROUP BY period`);
    const byPeriod = new Map(rets.map((r) => [r.period, r]));
    const periods = [...new Set([...rows.map((r) => String(r.period)), ...rets.map((r) => r.period)])].sort();
    return {
      columns: cols('period bills:int subtotal:money discount:money tax:money total:money returns:money net:money paid:money due:money profit:money'),
      rows: periods.map((p) => {
        const r = rows.find((x) => x.period === p) ?? { bills: 0, subtotal: 0, discount: 0, tax: 0, total: 0, paid: 0, due: 0, profit: 0 };
        const ret = byPeriod.get(p);
        return { ...r, period: p, returns: ret?.refunds ?? 0, net: Number(r.total) - (ret?.refunds ?? 0), profit: Number(r.profit) - (ret?.lostProfit ?? 0) };
      }),
    };
  },

  items(db, q) {
    const key = q.group === 'brand' ? sql`p.brand` : q.group === 'product' ? sql`p.code` : sql`coalesce(c.name_en, '—')`;
    const name = q.group === 'product' ? sql`p.name_en` : key;
    return {
      columns: cols(`name ${q.group === 'product' ? 'qty:qty ' : ''}bills:int amount:money profit:money`),
      rows: db.all(sql`
        SELECT ${key} AS key, ${name} AS name, sum(si.qty * si.pack_qty) AS qty, count(DISTINCT s.id) AS bills,
               sum(si.total) AS amount, sum(si.total - round(si.cost * si.qty)) AS profit
        FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
        LEFT JOIN categories c ON c.id = p.category_id
        WHERE s.status = 'done' AND s.created_at BETWEEN ${q.from} AND ${q.to}
        GROUP BY key ORDER BY amount DESC`),
    };
  },

  top(db, q) {
    return { columns: cols('code name qty:qty amount:money profit:money'), rows: reports.items(db, { ...q, group: 'product' }).rows.slice(0, 25).map((r) => ({ ...r, code: r.key })) };
  },

  dead(db, q) {
    return {
      columns: cols('code name stock:qty value:money lastSold:date'),
      rows: db.all(sql`
        SELECT p.code, p.name_en AS name, ps.qty AS stock, round(ps.qty * p.cost_price) AS value,
               (SELECT max(s.created_at) FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.product_id = p.id AND s.status = 'done') AS lastSold
        FROM products p JOIN product_stock ps ON ps.product_id = p.id
        WHERE p.active = 1 AND ps.qty > 0 AND NOT EXISTS (
          SELECT 1 FROM sale_items si JOIN sales s ON s.id = si.sale_id
          WHERE si.product_id = p.id AND s.status = 'done' AND s.created_at BETWEEN ${q.from} AND ${q.to})
        ORDER BY value DESC`),
    };
  },

  udhaar(db) {
    const balances = allBalances(db, 'customer');
    const rows = db
      .all<{ id: number; name: string; phone: string; creditLimit: number }>(sql`SELECT id, name, phone, credit_limit AS creditLimit FROM customers`)
      .map((c) => ({ ...c, balance: balances.get(c.id) ?? 0 }))
      .filter((c) => c.balance > 0)
      .sort((a, b) => b.balance - a.balance);
    return { columns: cols('name phone creditLimit:money balance:money'), rows };
  },

  payables(db) {
    const sup = allBalances(db, 'supplier');
    const plu = allBalances(db, 'plumber');
    const rows = [
      ...db.all<{ id: number; name: string; phone: string }>(sql`SELECT id, name, phone FROM suppliers`).map((s) => ({ kind: 'supplier', name: s.name, phone: s.phone, balance: sup.get(s.id) ?? 0 })),
      ...db.all<{ id: number; name: string; phone: string }>(sql`SELECT id, name, phone FROM plumbers`).map((p) => ({ kind: 'plumber', name: p.name, phone: p.phone, balance: plu.get(p.id) ?? 0 })),
    ]
      .filter((r) => r.balance > 0)
      .sort((a, b) => b.balance - a.balance);
    return { columns: cols('kind name phone balance:money'), rows };
  },

  stock(db, q) {
    const byProduct = q.group === 'product';
    return {
      columns: cols(byProduct ? 'code name stock:qty costValue:money retailValue:money' : 'name items:int costValue:money retailValue:money'),
      rows: byProduct
        ? db.all(sql`
            SELECT p.code, p.name_en AS name, ps.qty AS stock, round(ps.qty * p.cost_price) AS costValue, round(ps.qty * p.retail_price) AS retailValue
            FROM products p JOIN product_stock ps ON ps.product_id = p.id WHERE p.active = 1 AND ps.qty > 0 ORDER BY costValue DESC`)
        : db.all(sql`
            SELECT coalesce(c.name_en, '—') AS name, count(*) AS items,
                   sum(round(max(ps.qty, 0) * p.cost_price)) AS costValue, sum(round(max(ps.qty, 0) * p.retail_price)) AS retailValue
            FROM products p JOIN product_stock ps ON ps.product_id = p.id LEFT JOIN categories c ON c.id = p.category_id
            WHERE p.active = 1 GROUP BY name ORDER BY costValue DESC`),
    };
  },

  staff(db, q) {
    const byDevice = q.group === 'device';
    const join = byDevice ? sql`LEFT JOIN devices d ON d.id = s.device_id` : sql`LEFT JOIN users u ON u.id = s.user_id`;
    const name = byDevice ? sql`coalesce(d.name, '—')` : sql`u.name`;
    return {
      columns: cols('name bills:int total:money discount:money due:money profit:money'),
      rows: db.all(sql`
        SELECT ${name} AS name, count(*) AS bills, sum(s.total) AS total, sum(s.discount) AS discount, sum(s.due) AS due, sum(${SALE_PROFIT}) AS profit
        FROM sales s ${join} WHERE s.status = 'done' AND s.created_at BETWEEN ${q.from} AND ${q.to}
        GROUP BY name ORDER BY total DESC`),
    };
  },

  returns(db, q) {
    return {
      columns: cols('createdAt:date billNo customer refundType value:money restock:money refund:money reason user'),
      rows: db.all(sql`
        SELECT r.created_at AS createdAt, s.bill_no AS billNo, c.name AS customer, r.refund_type AS refundType, r.total AS value,
               r.restock_charge AS restock, r.total - r.restock_charge AS refund, r.reason, u.name AS user
        FROM returns r LEFT JOIN sales s ON s.id = r.sale_id LEFT JOIN customers c ON c.id = r.customer_id LEFT JOIN users u ON u.id = r.user_id
        WHERE r.created_at BETWEEN ${q.from} AND ${q.to} ORDER BY r.id DESC`),
    };
  },

  cancels(db, q) {
    return {
      columns: cols('createdAt:date billNo customer total:money reason user'),
      rows: db.all(sql`
        SELECT s.created_at AS createdAt, s.bill_no AS billNo, c.name AS customer, s.total, s.cancel_reason AS reason, u.name AS user
        FROM sales s LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN users u ON u.id = s.user_id
        WHERE s.status = 'cancelled' AND s.bill_no NOT LIKE 'H%' AND s.bill_no NOT LIKE 'Q%' AND s.created_at BETWEEN ${q.from} AND ${q.to}
        ORDER BY s.id DESC`),
    };
  },

  discounts(db, q) {
    return {
      columns: cols('createdAt:date billNo customer user gross:money discount:money total:money pct:pct'),
      rows: db.all(sql`
        SELECT * FROM (
          SELECT s.created_at AS createdAt, s.bill_no AS billNo, c.name AS customer, u.name AS user,
                 s.subtotal + coalesce((SELECT sum(discount) FROM sale_items WHERE sale_id = s.id), 0) AS gross,
                 s.discount + coalesce((SELECT sum(discount) FROM sale_items WHERE sale_id = s.id), 0) AS discount, s.total
          FROM sales s LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN users u ON u.id = s.user_id
          WHERE s.status = 'done' AND s.created_at BETWEEN ${q.from} AND ${q.to}
        ) WHERE discount > 0 ORDER BY createdAt DESC`)
        .map((r) => {
          const row = r as { gross: number; discount: number };
          return { ...row, pct: row.gross ? Math.round((row.discount / row.gross) * 10000) / 100 : 0 };
        }),
    };
  },
};

export function runReport(db: DB, kind: string, q: Partial<Q> = {}): Report {
  const fn = reports[kind];
  if (!fn) throw badRequest('NO_REPORT', `Unknown report ${kind}`);
  return fn(db, query.parse(q));
}

/** Excel sheet of a report (money in rupees, dates as dates). */
export function reportSheet(wb: ExcelJS.Workbook, title: string, report: Report) {
  addSheet(
    wb,
    title,
    report.columns.map((c) => ({ header: c.key, key: c.key, width: c.type === 'text' ? 26 : 16 })),
    report.rows.map((r) =>
      Object.fromEntries(
        report.columns.map((c) => {
          const v = r[c.key];
          if (c.type === 'money') return [c.key, Number(v ?? 0) / 100];
          if (c.type === 'date') return [c.key, v ? new Date(Number(v)) : ''];
          return [c.key, v ?? ''];
        }),
      ),
    ),
  );
}

export function reportRoutes(app: FastifyInstance): void {
  const { db } = app.ctx;

  app.get('/api/reports/:kind', { preHandler: requirePerm('report.all') }, async (req, reply) => {
    const { kind } = z.object({ kind: z.string() }).parse(req.params);
    const q = query.parse(req.query);
    const report = runReport(db, kind, q);
    if (q.format !== 'xlsx') return report;
    const wb = new ExcelJS.Workbook();
    reportSheet(wb, kind, report);
    return sendWorkbook(reply, wb, `${kind}-report.xlsx`);
  });

  /** Home screen numbers. Profit only for users who may see cost. */
  app.get('/api/dashboard', { preHandler: requirePerm('sale') }, async (req) => {
    const showProfit = can(auth(req).role, 'cost.view');
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const today = db.get<{ bills: number; total: number; profit: number; cash: number }>(sql`
      SELECT count(*) AS bills, coalesce(sum(s.total), 0) AS total, coalesce(sum(${SALE_PROFIT}), 0) AS profit,
             coalesce(sum(CASE WHEN s.payment_method = 'cash' THEN s.paid ELSE 0 END), 0) AS cash
      FROM sales s WHERE s.status = 'done' AND s.created_at >= ${start.getTime()}`)!;
    const cashIn = db.get<{ v: number }>(sql`SELECT coalesce(sum(amount), 0) AS v FROM payments WHERE method = 'cash' AND direction = 'in' AND created_at >= ${start.getTime()}`)!.v;
    const weekStart = start.getTime() - 6 * 86_400_000;
    const last7 = reports.sales(db, { from: weekStart, to: Date.now(), format: 'json' }).rows;
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart + i * 86_400_000);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const r = last7.find((x) => x.period === key);
      return { day: key, total: Number(r?.net ?? 0), ...(showProfit ? { profit: Number(r?.profit ?? 0) } : {}) };
    });
    const udhaar = [...allBalances(db, 'customer').values()].filter((b) => b > 0).reduce((s, b) => s + b, 0);
    const lowStock = db.all<{ id: number; code: string; name: string; nameUr: string; unit: string; stock: number; minStock: number }>(sql`
      SELECT p.id, p.code, p.name_en AS name, p.name_ur AS nameUr, p.unit, coalesce(ps.qty, 0) AS stock, p.min_stock AS minStock
      FROM products p LEFT JOIN product_stock ps ON ps.product_id = p.id
      WHERE p.active = 1 AND coalesce(ps.qty, 0) <= p.min_stock ORDER BY (coalesce(ps.qty, 0) - p.min_stock) LIMIT 50`);
    const recent = db.all(sql`
      SELECT s.id, s.bill_no AS billNo, s.total, s.due, s.status, s.created_at AS createdAt, c.name AS customerName
      FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.status IN ('done', 'cancelled') ORDER BY s.id DESC LIMIT 8`);
    return {
      today: { bills: today.bills, total: today.total, cash: today.cash + cashIn, udhaar, lowStock: lowStock.length, ...(showProfit ? { profit: today.profit } : {}) },
      days,
      lowStock: lowStock.slice(0, 10),
      recent,
    };
  });
}
