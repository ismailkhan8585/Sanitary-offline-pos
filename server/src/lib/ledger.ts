import { sql } from 'drizzle-orm';
import type { DB } from '../db';

/**
 * Khata (ledger) maths. A positive balance means:
 *   customer → the customer owes the shop;  supplier → the shop owes the supplier;  plumber → the shop owes the plumber.
 *
 * Customer: opening + bills (total − paid) − khata/exchange returns − challan advances − payments in + refunds out.
 * Credit applied on a bill (advance / exchange) is already counted by its own row, so it is not subtracted again.
 * Supplier: opening + purchases (total − paid) − purchase returns (total − refund received) − payments out + payments in.
 * Plumber:  commission on finished bills − payouts + money returned by the plumber.
 */

const customerParts = sql`
  coalesce((SELECT sum(total - paid) FROM sales WHERE customer_id = c.id AND status = 'done'), 0)
  - coalesce((SELECT sum(total - restock_charge) FROM returns WHERE customer_id = c.id AND refund_type IN ('khata', 'exchange')), 0)
  - coalesce((SELECT sum(advance) FROM challans WHERE customer_id = c.id), 0)
  - coalesce((SELECT sum(amount) FROM payments WHERE party_type = 'customer' AND party_id = c.id AND direction = 'in'), 0)
  + coalesce((SELECT sum(amount) FROM payments WHERE party_type = 'customer' AND party_id = c.id AND direction = 'out'), 0)`;

const supplierParts = sql`
  coalesce((SELECT sum(total - paid) FROM purchases WHERE supplier_id = s.id AND is_return = 0), 0)
  - coalesce((SELECT sum(total - paid) FROM purchases WHERE supplier_id = s.id AND is_return = 1), 0)
  - coalesce((SELECT sum(amount) FROM payments WHERE party_type = 'supplier' AND party_id = s.id AND direction = 'out'), 0)
  + coalesce((SELECT sum(amount) FROM payments WHERE party_type = 'supplier' AND party_id = s.id AND direction = 'in'), 0)`;

const plumberParts = sql`
  coalesce((SELECT sum(commission) FROM sales WHERE plumber_id = p.id AND status = 'done'), 0)
  - coalesce((SELECT sum(amount) FROM payments WHERE party_type = 'plumber' AND party_id = p.id AND direction = 'out'), 0)
  + coalesce((SELECT sum(amount) FROM payments WHERE party_type = 'plumber' AND party_id = p.id AND direction = 'in'), 0)`;

export function customerBalance(db: DB, customerId: number): number {
  return db.get<{ b: number }>(sql`SELECT c.opening_balance + ${customerParts} AS b FROM customers c WHERE c.id = ${customerId}`)?.b ?? 0;
}

export function supplierBalance(db: DB, supplierId: number): number {
  return db.get<{ b: number }>(sql`SELECT s.opening_balance + ${supplierParts} AS b FROM suppliers s WHERE s.id = ${supplierId}`)?.b ?? 0;
}

export function plumberBalance(db: DB, plumberId: number): number {
  return db.get<{ b: number }>(sql`SELECT ${plumberParts} AS b FROM plumbers p WHERE p.id = ${plumberId}`)?.b ?? 0;
}

/** Balance of every party in one query, for lists. */
export function allBalances(db: DB, type: 'customer' | 'supplier' | 'plumber'): Map<number, number> {
  const rows =
    type === 'customer'
      ? db.all<{ id: number; b: number }>(sql`SELECT c.id, c.opening_balance + ${customerParts} AS b FROM customers c`)
      : type === 'supplier'
        ? db.all<{ id: number; b: number }>(sql`SELECT s.id, s.opening_balance + ${supplierParts} AS b FROM suppliers s`)
        : db.all<{ id: number; b: number }>(sql`SELECT p.id, ${plumberParts} AS b FROM plumbers p`);
  return new Map(rows.map((r) => [r.id, r.b]));
}

export interface LedgerEntry {
  date: number;
  kind: string;
  ref: string;
  note: string;
  /** Increases the balance. */
  debit: number;
  /** Decreases the balance. */
  credit: number;
  balance: number;
}

type RawEntry = Omit<LedgerEntry, 'balance'>;

function withRunningBalance(opening: number, openingDate: number, entries: RawEntry[]): LedgerEntry[] {
  const sorted = [...entries].sort((a, b) => a.date - b.date);
  let balance = opening;
  const out: LedgerEntry[] = [{ date: openingDate, kind: 'opening', ref: '', note: '', debit: Math.max(opening, 0), credit: Math.max(-opening, 0), balance }];
  for (const e of sorted) {
    balance += e.debit - e.credit;
    out.push({ ...e, balance });
  }
  return out;
}

export function customerLedger(db: DB, customerId: number): LedgerEntry[] {
  const c = db.get<{ opening_balance: number; created_at: number }>(sql`SELECT opening_balance, created_at FROM customers WHERE id = ${customerId}`);
  if (!c) return [];
  const entries = db.all<RawEntry>(sql`
    SELECT created_at AS date, 'sale' AS kind, bill_no AS ref, payment_method AS note, total AS debit, paid AS credit
      FROM sales WHERE customer_id = ${customerId} AND status = 'done'
    UNION ALL
    SELECT r.created_at, 'return_' || r.refund_type, coalesce(s.bill_no, ''), r.reason, 0, r.total - r.restock_charge
      FROM returns r LEFT JOIN sales s ON s.id = r.sale_id
      WHERE r.customer_id = ${customerId} AND r.refund_type IN ('khata', 'exchange')
    UNION ALL
    SELECT created_at, 'challan_advance', challan_no, site_name, 0, advance FROM challans WHERE customer_id = ${customerId} AND advance > 0
    UNION ALL
    SELECT created_at, 'payment_' || direction, method, note,
           CASE WHEN direction = 'out' THEN amount ELSE 0 END, CASE WHEN direction = 'in' THEN amount ELSE 0 END
      FROM payments WHERE party_type = 'customer' AND party_id = ${customerId}
  `);
  return withRunningBalance(c.opening_balance, c.created_at, entries);
}

export function supplierLedger(db: DB, supplierId: number): LedgerEntry[] {
  const s = db.get<{ opening_balance: number }>(sql`SELECT opening_balance FROM suppliers WHERE id = ${supplierId}`);
  if (!s) return [];
  const entries = db.all<RawEntry>(sql`
    SELECT created_at AS date, CASE WHEN is_return = 1 THEN 'purchase_return' ELSE 'purchase' END AS kind, invoice_no AS ref, payment_method AS note,
           CASE WHEN is_return = 1 THEN paid ELSE total END AS debit,
           CASE WHEN is_return = 1 THEN total ELSE paid END AS credit
      FROM purchases WHERE supplier_id = ${supplierId}
    UNION ALL
    SELECT created_at, 'payment_' || direction, method, note,
           CASE WHEN direction = 'in' THEN amount ELSE 0 END, CASE WHEN direction = 'out' THEN amount ELSE 0 END
      FROM payments WHERE party_type = 'supplier' AND party_id = ${supplierId}
  `);
  const first = entries.reduce((m, e) => Math.min(m, e.date), Date.now());
  return withRunningBalance(s.opening_balance, first, entries);
}

export function plumberLedger(db: DB, plumberId: number): LedgerEntry[] {
  const entries = db.all<RawEntry>(sql`
    SELECT created_at AS date, 'commission' AS kind, bill_no AS ref, '' AS note, commission AS debit, 0 AS credit
      FROM sales WHERE plumber_id = ${plumberId} AND status = 'done' AND commission > 0
    UNION ALL
    SELECT created_at, 'payment_' || direction, method, note,
           CASE WHEN direction = 'in' THEN amount ELSE 0 END, CASE WHEN direction = 'out' THEN amount ELSE 0 END
      FROM payments WHERE party_type = 'plumber' AND party_id = ${plumberId}
  `);
  const first = entries.reduce((m, e) => Math.min(m, e.date), Date.now());
  return withRunningBalance(0, first, entries);
}
