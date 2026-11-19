import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import type { DB } from '../db';
import { requirePerm } from '../lib/auth';
import { getAllSettings } from '../lib/settings';
import { sendWorkbook } from '../lib/excel';
import { formatMoney } from '../shared/money';
import { reportSheet, runReport } from './reports';

function dayRange(day: Date) {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  return { from: start.getTime(), to: start.getTime() + 86_400_000 - 1 };
}

/** Numbers for the end-of-day sheet. */
export function closingFigures(db: DB, day: Date) {
  const { from, to } = dayRange(day);
  const one = (q: ReturnType<typeof sql>) => Number(db.get<{ v: number | null }>(q)?.v ?? 0);
  const methods = db.all<{ method: string; bills: number; total: number; paid: number }>(sql`
    SELECT payment_method AS method, count(*) AS bills, sum(total) AS total, sum(paid) AS paid
    FROM sales WHERE status = 'done' AND created_at BETWEEN ${from} AND ${to} GROUP BY payment_method`);
  const expenses = db.all<{ category: string; amount: number }>(sql`
    SELECT category, sum(amount) AS amount FROM expenses WHERE created_at BETWEEN ${from} AND ${to} GROUP BY category ORDER BY amount DESC`);
  return {
    from,
    bills: methods.reduce((s, m) => s + m.bills, 0),
    sales: methods.reduce((s, m) => s + m.total, 0),
    methods,
    discount: one(sql`SELECT sum(discount) AS v FROM sales WHERE status = 'done' AND created_at BETWEEN ${from} AND ${to}`),
    udhaarGiven: one(sql`SELECT sum(due) AS v FROM sales WHERE status = 'done' AND created_at BETWEEN ${from} AND ${to}`),
    returns: one(sql`SELECT sum(total - restock_charge) AS v FROM returns WHERE created_at BETWEEN ${from} AND ${to}`),
    cancelled: one(sql`SELECT count(*) AS v FROM sales WHERE status = 'cancelled' AND bill_no NOT LIKE 'H%' AND bill_no NOT LIKE 'Q%' AND created_at BETWEEN ${from} AND ${to}`),
    khataReceived: one(sql`SELECT sum(amount) AS v FROM payments WHERE party_type = 'customer' AND direction = 'in' AND created_at BETWEEN ${from} AND ${to}`),
    paidOut: one(sql`SELECT sum(amount) AS v FROM payments WHERE direction = 'out' AND created_at BETWEEN ${from} AND ${to}`),
    expenses,
    expenseTotal: expenses.reduce((s, e) => s + e.amount, 0),
    purchases: one(sql`SELECT sum(total) AS v FROM purchases WHERE is_return = 0 AND created_at BETWEEN ${from} AND ${to}`),
    top: runReport(db, 'top', { from, to }).rows.slice(0, 10) as { name: string; qty: number; amount: number }[],
  };
}

/** Daily closing report as a PDF (English; printable on A4). */
export function closingPdf(db: DB, day: Date): Promise<Buffer> {
  const f = closingFigures(db, day);
  const shop = getAllSettings(db);
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  doc.fontSize(18).font('Helvetica-Bold').text(shop.shop_name_en ?? 'Shop');
  doc.fontSize(10).font('Helvetica').text([shop.shop_address, shop.shop_phone].filter(Boolean).join('  ·  '));
  doc.moveDown(0.5).fontSize(14).font('Helvetica-Bold').text(`Daily closing report — ${new Date(f.from).toDateString()}`);
  doc.moveDown();

  const row = (label: string, value: string, bold = false) => {
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(11).text(label, 40, y, { width: 330 });
    doc.text(value, 370, y, { width: 185, align: 'right' });
  };
  const section = (title: string) => doc.moveDown(0.6).font('Helvetica-Bold').fontSize(12).text(title, 40).moveDown(0.2);

  section('Sales');
  row('Bills', String(f.bills));
  row('Total sales', formatMoney(f.sales), true);
  for (const m of f.methods) row(`  ${m.method} (${m.bills} bills) — received`, formatMoney(m.paid));
  row('Discounts given', formatMoney(f.discount));
  row('Udhaar given today', formatMoney(f.udhaarGiven));
  row('Customer returns (refund value)', formatMoney(f.returns));
  row('Cancelled bills', String(f.cancelled));

  section('Money');
  row('Khata payments received', formatMoney(f.khataReceived));
  row('Payments given out', formatMoney(f.paidOut));
  row('Expenses', formatMoney(f.expenseTotal));
  for (const e of f.expenses) row(`  ${e.category}`, formatMoney(e.amount));
  row('Purchases (invoices)', formatMoney(f.purchases));

  section('Top items');
  for (const t of f.top) row(`  ${t.name}`, `${t.qty} · ${formatMoney(t.amount)}`);

  doc.moveDown(2).font('Helvetica').fontSize(9).fillColor('#64748b').text(`Printed ${new Date().toLocaleString('en-PK')} by Haroon POS`);
  doc.end();
  return done;
}

/** Month-end Excel: customer khata balances, stock, supplier balances. */
export function monthlyWorkbook(db: DB): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  reportSheet(wb, 'Customer balances', runReport(db, 'udhaar'));
  reportSheet(wb, 'Stock', runReport(db, 'stock', { group: 'product' }));
  const payables = runReport(db, 'payables');
  reportSheet(wb, 'Supplier balances', { ...payables, rows: payables.rows.filter((r) => r.kind === 'supplier') });
  return wb;
}

/** Saves the day's PDF (and on the 1st, last month's Excel) next to the backups. */
export async function saveExports(db: DB, backupDir: string, day = new Date()): Promise<string[]> {
  const dir = path.join(backupDir, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  const iso = day.toISOString().slice(0, 10);
  const files = [path.join(dir, `closing-${iso}.pdf`)];
  fs.writeFileSync(files[0], await closingPdf(db, day));
  if (day.getDate() === 1) {
    const file = path.join(dir, `monthly-${iso.slice(0, 7)}.xlsx`);
    await monthlyWorkbook(db).xlsx.writeFile(file);
    files.push(file);
  }
  return files;
}

export function closingRoutes(app: FastifyInstance): void {
  const { db } = app.ctx;
  const guard = { preHandler: requirePerm('report.all') };

  app.get('/api/reports/closing.pdf', guard, async (req, reply) => {
    const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(req.query);
    const day = date ? new Date(`${date}T12:00:00`) : new Date();
    const pdf = await closingPdf(db, day);
    return reply.header('content-type', 'application/pdf').header('content-disposition', `inline; filename="closing-${date ?? 'today'}.pdf"`).send(pdf);
  });

  app.get('/api/exports/monthly.xlsx', guard, async (_req, reply) => sendWorkbook(reply, monthlyWorkbook(db), `monthly-${new Date().toISOString().slice(0, 7)}.xlsx`));
}
