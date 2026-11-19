/** Bill arithmetic shared by the POS screen and the server, so both always agree to the paisa. */

export interface LineAmounts {
  qty: number;
  /** Paisa per sold unit (piece, coil, …). */
  rate: number;
  /** Paisa off this line. */
  discount: number;
}

export interface Totals {
  gross: number;
  lineDiscounts: number;
  subtotal: number;
  /** Bill-level discount actually applied. */
  discount: number;
  tax: number;
  total: number;
}

export function lineGross(l: LineAmounts): number {
  return Math.round(l.qty * l.rate);
}

export function lineTotal(l: LineAmounts): number {
  return lineGross(l) - l.discount;
}

export function billTotals(lines: LineAmounts[], billDiscount: number, taxPct: number): Totals {
  const gross = lines.reduce((s, l) => s + lineGross(l), 0);
  const lineDiscounts = lines.reduce((s, l) => s + l.discount, 0);
  const subtotal = gross - lineDiscounts;
  const discount = Math.max(0, Math.min(billDiscount, subtotal));
  const tax = Math.round(((subtotal - discount) * taxPct) / 100);
  return { gross, lineDiscounts, subtotal, discount, tax, total: subtotal - discount + tax };
}

/** All discounts (line + bill) as % of the gross amount — compared with the cashier's limit. */
export function discountPercent(t: Totals): number {
  return t.gross > 0 ? ((t.lineDiscounts + t.discount) / t.gross) * 100 : 0;
}

/** Plumber commission on the amount after discounts, before tax. */
export function commissionFor(t: Totals, pct: number): number {
  return Math.round(((t.subtotal - t.discount) * pct) / 100);
}
