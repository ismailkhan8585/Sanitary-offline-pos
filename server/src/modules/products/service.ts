import { and, eq, getTableColumns, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db';
import { categories, products, productStock } from '../../db/schema';
import { badRequest, notFound } from '../../lib/errors';
import { moveStock } from '../../lib/stock';
import type { Actor } from '../../lib/activity';

const money = z.number().int().min(0);
const text = (max: number) => z.string().trim().max(max).default('');

export const productInput = z.object({
  code: z.string().trim().min(1).max(40),
  barcode: z
    .string()
    .trim()
    .max(64)
    .nullish()
    .transform((v) => v || null),
  nameEn: z.string().trim().min(1).max(120),
  nameUr: text(120),
  aliases: text(300),
  categoryId: z.number().int().nullable().default(null),
  brand: text(60),
  size: text(60),
  color: text(40),
  unit: z.string().trim().min(1).max(20).default('piece'),
  packUnit: z
    .string()
    .trim()
    .max(20)
    .nullish()
    .transform((v) => v || null),
  packQty: z.number().positive().default(1),
  costPrice: money.default(0),
  retailPrice: money.default(0),
  plumberPrice: money.default(0),
  wholesalePrice: money.default(0),
  minStock: z.number().min(0).default(0),
  active: z.boolean().default(true),
});
export type ProductInput = z.infer<typeof productInput>;

/** Product with stock and category name, as lists and the POS need it. */
export function listProducts(db: DB) {
  return db
    .select({
      ...getTableColumns(products),
      stock: sql<number>`coalesce(${productStock.qty}, 0)`,
      categoryName: categories.nameEn,
    })
    .from(products)
    .leftJoin(productStock, eq(productStock.productId, products.id))
    .leftJoin(categories, eq(categories.id, products.categoryId))
    .orderBy(products.nameEn)
    .all();
}

export type ProductRow = ReturnType<typeof listProducts>[number];

/** Removes cost price for users who may not see it. */
export function hideCost<T extends { costPrice: number }>(rows: T[], canSeeCost: boolean): (T | Omit<T, 'costPrice'>)[] {
  if (canSeeCost) return rows;
  return rows.map(({ costPrice: _hidden, ...rest }) => rest);
}

function assertUnique(db: DB, input: Pick<ProductInput, 'code' | 'barcode'>, exceptId?: number) {
  const other = (cond: ReturnType<typeof eq>) =>
    db
      .select({ id: products.id })
      .from(products)
      .where(exceptId ? and(cond, ne(products.id, exceptId)) : cond)
      .get();
  if (other(eq(products.code, input.code))) throw badRequest('CODE_TAKEN', `Code ${input.code} is already used.`, { code: input.code });
  if (input.barcode && other(eq(products.barcode, input.barcode))) {
    throw badRequest('BARCODE_TAKEN', `Barcode ${input.barcode} is already used.`, { barcode: input.barcode });
  }
}

export function createProduct(db: DB, input: ProductInput, openingStock: number, actor: Actor) {
  assertUnique(db, input);
  const created = db
    .insert(products)
    .values({ ...input, updatedAt: Date.now() })
    .returning()
    .get();
  db.insert(productStock).values({ productId: created.id, qty: 0 }).run();
  if (openingStock) moveStock(db, { productId: created.id, qty: openingStock, type: 'opening', ...actor });
  return created;
}

export function updateProduct(db: DB, id: number, input: Partial<ProductInput>) {
  const current = db.select().from(products).where(eq(products.id, id)).get();
  if (!current) throw notFound('Product');
  assertUnique(db, { code: input.code ?? current.code, barcode: input.barcode === undefined ? current.barcode : input.barcode }, id);
  const updated = db
    .update(products)
    .set({ ...input, updatedAt: Date.now() })
    .where(eq(products.id, id))
    .returning()
    .get();
  return { before: current, after: updated };
}

export function findOrCreateCategory(db: DB, name: string): number | null {
  const clean = name.trim();
  if (!clean) return null;
  const found = db
    .select({ id: categories.id })
    .from(categories)
    .where(sql`lower(${categories.nameEn}) = lower(${clean})`)
    .get();
  return found?.id ?? db.insert(categories).values({ nameEn: clean }).returning({ id: categories.id }).get().id;
}

export const PRICE_FIELDS = ['costPrice', 'retailPrice', 'plumberPrice', 'wholesalePrice'] as const;

/** New price after a % change, rounded to whole rupees. */
export function adjustPrice(paisa: number, pct: number): number {
  return Math.max(0, Math.round((paisa * (1 + pct / 100)) / 100) * 100);
}
