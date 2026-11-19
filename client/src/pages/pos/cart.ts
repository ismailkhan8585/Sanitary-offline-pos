import type { Product } from '@/lib/types';
import { tierPrice, type PriceTier } from '@/lib/pricing';
import { billTotals, lineTotal, type Totals } from '@shared/billing';

export interface CartLine {
  key: string;
  productId: number;
  code: string;
  nameEn: string;
  nameUr: string;
  baseUnit: string;
  packUnit: string | null;
  productPackQty: number;
  /** Unit sold on this line: the base unit or the pack unit. */
  unit: string;
  qty: number;
  /** Paisa per `unit`. */
  rate: number;
  discount: number;
  /** True once the cashier typed a rate; tier changes then leave it alone. */
  manualRate: boolean;
  stock: number;
  minStock: number;
  prices: Pick<Product, 'retailPrice' | 'plumberPrice' | 'wholesalePrice'>;
  costPrice?: number;
}

export interface Cart {
  lines: CartLine[];
  tier: PriceTier;
  customerId: number | null;
  plumberId: number | null;
  billDiscount: number;
  /** Held bill this cart was recalled from. */
  heldId: number | null;
  /** Line to highlight (last added). */
  lastKey: string | null;
  /** Value of an exchange return paying part of this bill. */
  exchange: { returnId: number; amount: number } | null;
}

export const emptyCart: Cart = { lines: [], tier: 'retail', customerId: null, plumberId: null, billDiscount: 0, heldId: null, lastKey: null, exchange: null };

export function packQtyOf(line: Pick<CartLine, 'unit' | 'packUnit' | 'productPackQty'>): number {
  return line.packUnit && line.unit === line.packUnit ? line.productPackQty : 1;
}

function listRate(line: CartLine, tier: PriceTier, unit = line.unit): number {
  return Math.round(tierPrice(line.prices, tier) * packQtyOf({ ...line, unit }));
}

export type CartAction =
  | { type: 'add'; product: Product; unit?: string; qty?: number }
  | { type: 'setQty'; key: string; qty: number }
  | { type: 'step'; key: string; delta: number }
  | { type: 'update'; key: string; unit: string; qty: number; rate: number; discount: number }
  | { type: 'remove'; key: string }
  | { type: 'restore'; line: CartLine; index: number }
  | { type: 'setTier'; tier: PriceTier }
  | { type: 'setCustomer'; customerId: number | null; tier?: PriceTier }
  | { type: 'setPlumber'; plumberId: number | null }
  | { type: 'setBillDiscount'; amount: number }
  | { type: 'setExchange'; exchange: Cart['exchange'] }
  | { type: 'load'; cart: Cart }
  | { type: 'clear' };

let seq = 0;

export function cartReducer(cart: Cart, action: CartAction): Cart {
  switch (action.type) {
    case 'add': {
      const p = action.product;
      const unit = action.unit ?? p.unit;
      const qty = action.qty ?? 1;
      const existing = cart.lines.find((l) => l.productId === p.id && l.unit === unit);
      if (existing) {
        return { ...cart, lastKey: existing.key, lines: cart.lines.map((l) => (l === existing ? { ...l, qty: round3(l.qty + qty) } : l)) };
      }
      const line: CartLine = {
        key: `l${++seq}`,
        productId: p.id,
        code: p.code,
        nameEn: p.nameEn,
        nameUr: p.nameUr,
        baseUnit: p.unit,
        packUnit: p.packUnit,
        productPackQty: p.packQty,
        unit,
        qty,
        rate: 0,
        discount: 0,
        manualRate: false,
        stock: p.stock,
        minStock: p.minStock,
        prices: { retailPrice: p.retailPrice, plumberPrice: p.plumberPrice, wholesalePrice: p.wholesalePrice },
        costPrice: p.costPrice,
      };
      line.rate = listRate(line, cart.tier);
      return { ...cart, lastKey: line.key, lines: [...cart.lines, line] };
    }
    case 'setQty':
      return mapLine(cart, action.key, (l) => ({ ...l, qty: Math.max(0.001, round3(action.qty)) }));
    case 'step':
      return mapLine(cart, action.key, (l) => ({ ...l, qty: Math.max(1, round3(l.qty + action.delta)) }));
    case 'update':
      return mapLine(cart, action.key, (l) => {
        // The editor shows the list rate of the new unit after a unit change; any other value was typed.
        const expected = action.unit !== l.unit && !l.manualRate ? listRate(l, cart.tier, action.unit) : l.rate;
        const typed = action.rate !== expected;
        return { ...l, unit: action.unit, qty: round3(action.qty), rate: action.rate, discount: action.discount, manualRate: l.manualRate || typed };
      });
    case 'remove':
      return { ...cart, lines: cart.lines.filter((l) => l.key !== action.key) };
    case 'restore': {
      const lines = [...cart.lines];
      lines.splice(Math.min(action.index, lines.length), 0, action.line);
      return { ...cart, lines, lastKey: action.line.key };
    }
    case 'setTier':
      return repriced({ ...cart, tier: action.tier });
    case 'setCustomer':
      return repriced({ ...cart, customerId: action.customerId, tier: action.tier ?? cart.tier });
    case 'setPlumber':
      return { ...cart, plumberId: action.plumberId };
    case 'setBillDiscount':
      return { ...cart, billDiscount: Math.max(0, Math.round(action.amount)) };
    case 'setExchange':
      return { ...cart, exchange: action.exchange };
    case 'load':
      return action.cart;
    case 'clear':
      return emptyCart;
  }
}

function mapLine(cart: Cart, key: string, fn: (l: CartLine) => CartLine): Cart {
  return { ...cart, lines: cart.lines.map((l) => (l.key === key ? fn(l) : l)) };
}

function repriced(cart: Cart): Cart {
  return { ...cart, lines: cart.lines.map((l) => (l.manualRate ? l : { ...l, rate: listRate(l, cart.tier) })) };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function cartTotals(cart: Cart, taxPct: number): Totals {
  return billTotals(cart.lines, cart.billDiscount, taxPct);
}

export function lineAmount(l: CartLine): number {
  return lineTotal(l);
}

/** Base-unit quantity of this product already in the cart (all lines). */
export function qtyInCart(cart: Cart, productId: number): number {
  return cart.lines.filter((l) => l.productId === productId).reduce((s, l) => s + l.qty * packQtyOf(l), 0);
}

/** Request body for POST /api/sales. */
export function toSaleItems(cart: Cart) {
  return cart.lines.map((l) => ({ productId: l.productId, qty: l.qty, unit: l.unit, rate: l.rate, discount: l.discount }));
}
