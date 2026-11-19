import { eq, sql } from 'drizzle-orm';
import type { DB } from '../db';
import { productStock, stockMovements, stockMovementTypes } from '../db/schema';

export interface Movement {
  productId: number;
  /** Base units; + adds stock, − removes it. */
  qty: number;
  type: (typeof stockMovementTypes)[number];
  refId?: number | null;
  userId?: number | null;
  deviceId?: number | null;
}

/**
 * Records a stock movement and updates product_stock. Call inside the caller's
 * transaction so both rows are written together.
 */
export function moveStock(db: DB, m: Movement): void {
  if (m.qty === 0) return;
  db.insert(stockMovements).values(m).run();
  db.insert(productStock)
    .values({ productId: m.productId, qty: m.qty })
    .onConflictDoUpdate({ target: productStock.productId, set: { qty: sql`round(${productStock.qty} + ${m.qty}, 3)` } })
    .run();
}

export function currentStock(db: DB, productId: number): number {
  return db.select({ qty: productStock.qty }).from(productStock).where(eq(productStock.productId, productId)).get()?.qty ?? 0;
}

/** Stock as the sum of all movements — the source of truth product_stock must match. */
export function stockFromMovements(db: DB, productId: number): number {
  const row = db
    .select({ qty: sql<number>`coalesce(round(sum(${stockMovements.qty}), 3), 0)` })
    .from(stockMovements)
    .where(eq(stockMovements.productId, productId))
    .get();
  return row?.qty ?? 0;
}
