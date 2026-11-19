export type PriceTier = 'retail' | 'plumber' | 'wholesale';

export const PRICE_TIERS: PriceTier[] = ['retail', 'plumber', 'wholesale'];

/** Base-unit price of a product for a price tier (falls back to retail when the tier price is 0). */
export function tierPrice(p: { retailPrice: number; plumberPrice: number; wholesalePrice: number }, tier: PriceTier): number {
  const price = tier === 'plumber' ? p.plumberPrice : tier === 'wholesale' ? p.wholesalePrice : p.retailPrice;
  return price || p.retailPrice;
}
