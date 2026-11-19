import { sql } from 'drizzle-orm';
import type { DB } from '../db';

/**
 * Customer balance (what the customer owes us), from every money event:
 *   opening + bills (total − paid) − khata/exchange returns − challan advances − payments in + refunds out.
 * Credit applied on a bill (advance / exchange) is already counted by its own row, so it is not subtracted again.
 */
export function customerBalance(db: DB, customerId: number): number {
  const row = db.get<{ balance: number }>(sql`
    SELECT
      coalesce((SELECT opening_balance FROM customers WHERE id = ${customerId}), 0)
      + coalesce((SELECT sum(total - paid) FROM sales WHERE customer_id = ${customerId} AND status = 'done'), 0)
      - coalesce((SELECT sum(total - restock_charge) FROM returns WHERE customer_id = ${customerId} AND refund_type IN ('khata', 'exchange')), 0)
      - coalesce((SELECT sum(advance) FROM challans WHERE customer_id = ${customerId}), 0)
      - coalesce((SELECT sum(amount) FROM payments WHERE party_type = 'customer' AND party_id = ${customerId} AND direction = 'in'), 0)
      + coalesce((SELECT sum(amount) FROM payments WHERE party_type = 'customer' AND party_id = ${customerId} AND direction = 'out'), 0)
      AS balance
  `);
  return row?.balance ?? 0;
}
