import { eq } from 'drizzle-orm';
import type { DB } from '../../db';
import { customers } from '../../db/schema';
import type { Violation } from '../../lib/approval';
import type { AuthInfo } from '../../lib/auth';
import { customerBalance } from '../../lib/ledger';
import { discountPercent } from '../../shared/billing';
import type { PreparedSale, SaleInput } from './service';

/** Rules a cashier needs an Admin PIN for when finishing a bill. */
export function saleViolations(db: DB, user: AuthInfo, input: SaleInput, prepared: PreparedSale, credit: number): Violation[] {
  if (input.status !== 'done') return [];
  const out: Violation[] = [];
  const { totals, lines } = prepared;

  const pct = discountPercent(totals);
  if (pct > user.discountLimitPct + 1e-9) out.push({ action: 'discount_limit', details: { pct: Math.round(pct * 100) / 100, limit: user.discountLimitPct } });

  // Price per unit after the line discount and this line's share of the bill discount.
  const billShare = totals.subtotal > 0 ? (totals.subtotal - totals.discount) / totals.subtotal : 1;
  const belowCost = lines.filter((l) => l.qty > 0 && (l.total * billShare) / l.qty < l.costPerUnit).map((l) => l.name);
  if (belowCost.length) out.push({ action: 'below_cost', details: { items: belowCost } });

  const qtyByProduct = new Map<number, { name: string; qty: number; stock: number }>();
  for (const l of lines) {
    const cur = qtyByProduct.get(l.productId) ?? { name: l.name, qty: 0, stock: l.stock };
    cur.qty += l.baseQty;
    qtyByProduct.set(l.productId, cur);
  }
  const short = [...qtyByProduct.values()].filter((p) => p.qty > p.stock).map((p) => ({ name: p.name, stock: p.stock }));
  if (short.length) out.push({ action: 'zero_stock', details: { items: short } });

  const changed = lines.filter((l) => l.rate !== l.listRate).map((l) => ({ name: l.name, from: l.listRate, to: l.rate }));
  if (changed.length) out.push({ action: 'rate_change', details: { items: changed } });

  const due = totals.total - credit - Math.min(input.paid, totals.total - credit);
  if (due > 0 && input.customerId) {
    const customer = db.select().from(customers).where(eq(customers.id, input.customerId)).get();
    const after = customerBalance(db, input.customerId) + due;
    if (customer && customer.creditLimit > 0 && after > customer.creditLimit) {
      out.push({ action: 'credit_limit', details: { customer: customer.name, limit: customer.creditLimit, balanceAfter: after } });
    }
  }
  return out;
}
