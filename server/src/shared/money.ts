/** Money is stored as integer paisa. Rs 1,250.50 = 125050. */

export function toPaisa(rupees: number): number {
  return Math.round(rupees * 100);
}

export function toRupees(paisa: number): number {
  return paisa / 100;
}

/** "Rs 12,450" — paisa shown only when not a whole rupee. Negative shown as "-Rs 500". */
export function formatMoney(paisa: number, withSymbol = true): string {
  const sign = paisa < 0 ? '-' : '';
  const abs = Math.abs(paisa);
  const hasPaisa = abs % 100 !== 0;
  const text = (abs / 100).toLocaleString('en-US', {
    minimumFractionDigits: hasPaisa ? 2 : 0,
    maximumFractionDigits: 2,
  });
  return `${sign}${withSymbol ? 'Rs ' : ''}${text}`;
}

/** Quantities: up to 3 decimals, no trailing zeros. */
export function formatQty(qty: number): string {
  return Number(qty.toFixed(3)).toLocaleString('en-US', { maximumFractionDigits: 3 });
}
