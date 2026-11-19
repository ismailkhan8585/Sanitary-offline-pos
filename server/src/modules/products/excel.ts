import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import { products } from '../../db/schema';
import type { DB } from '../../db';
import type BetterSqlite3 from 'better-sqlite3';
import { actorOf, requirePerm } from '../../lib/auth';
import { addSheet, cellText, sendWorkbook } from '../../lib/excel';
import { logActivity, type Actor } from '../../lib/activity';
import { transaction } from '../../lib/tx';
import { badRequest } from '../../lib/errors';
import { toPaisa } from '../../shared/money';
import { createProduct, findOrCreateCategory, listProducts, productInput, updateProduct, type ProductInput } from './service';

/** Excel columns: header name → product field. Prices are in rupees in the sheet. */
const COLUMNS = [
  { header: 'code', field: 'code' },
  { header: 'barcode', field: 'barcode' },
  { header: 'name_en', field: 'nameEn', width: 32 },
  { header: 'name_ur', field: 'nameUr', width: 28 },
  { header: 'aliases', field: 'aliases', width: 24 },
  { header: 'category', field: 'category' },
  { header: 'brand', field: 'brand' },
  { header: 'size', field: 'size' },
  { header: 'color', field: 'color' },
  { header: 'unit', field: 'unit' },
  { header: 'pack_unit', field: 'packUnit' },
  { header: 'pack_qty', field: 'packQty' },
  { header: 'cost_price', field: 'costPrice' },
  { header: 'retail_price', field: 'retailPrice' },
  { header: 'plumber_price', field: 'plumberPrice' },
  { header: 'wholesale_price', field: 'wholesalePrice' },
  { header: 'min_stock', field: 'minStock' },
  { header: 'stock', field: 'stock' },
] as const;

const MONEY = new Set(['costPrice', 'retailPrice', 'plumberPrice', 'wholesalePrice']);
const NUMBER = new Set(['packQty', 'minStock', 'stock']);

export interface ImportResult {
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
}

/** Imports products from an Excel sheet. Existing codes are updated (only the columns present); stock is set only for new products. */
export function importProducts(db: DB, sqlite: BetterSqlite3.Database, ws: ExcelJS.Worksheet, actor: Actor): ImportResult {
  const headerRow = ws.getRow(1);
  const colIndex = new Map<string, number>();
  headerRow.eachCell((cell, col) => colIndex.set(cellText(cell.value).toLowerCase().replace(/\s+/g, '_'), col));
  if (!colIndex.has('code') || !colIndex.has('name_en')) {
    throw badRequest('IMPORT_BAD_HEADER', 'The first row must have column names. "code" and "name_en" are required. Download the template.');
  }
  const result: ImportResult = { created: 0, updated: 0, errors: [] };
  transaction(sqlite, () => {
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const raw: Record<string, string> = {};
      for (const c of COLUMNS) {
        const idx = colIndex.get(c.header);
        if (idx) raw[c.field] = cellText(row.getCell(idx).value);
      }
      if (!raw.code && !raw.nameEn) continue;
      try {
        transaction(sqlite, () => importRow(db, raw, actor, result));
      } catch (e) {
        result.errors.push({ row: r, message: e instanceof Error ? e.message.split('\n')[0] : String(e) });
      }
    }
    logActivity(db, actor, 'product.import', { created: result.created, updated: result.updated, errors: result.errors.length });
  });
  return result;
}

function importRow(db: DB, raw: Record<string, string>, actor: Actor, result: ImportResult) {
  const values: Record<string, unknown> = {};
  for (const [field, text] of Object.entries(raw)) {
    if (field === 'stock' || field === 'category') continue;
    if (MONEY.has(field)) values[field] = text ? toPaisa(parseNumber(text, field)) : 0;
    else if (NUMBER.has(field)) values[field] = text ? parseNumber(text, field) : field === 'packQty' ? 1 : 0;
    else values[field] = text;
  }
  if ('category' in raw) values.categoryId = findOrCreateCategory(db, raw.category);
  const existing = db.select({ id: products.id }).from(products).where(eq(products.code, raw.code)).get();
  if (existing) {
    updateProduct(db, existing.id, productInput.partial().parse(values) as Partial<ProductInput>);
    result.updated++;
  } else {
    const stock = raw.stock ? parseNumber(raw.stock, 'stock') : 0;
    createProduct(db, productInput.parse(values), stock, actor);
    result.created++;
  }
}

function parseNumber(text: string, field: string): number {
  const n = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(n)) throw new Error(`${field}: "${text}" is not a number`);
  return n;
}

export function productExcelRoutes(app: FastifyInstance): void {
  const { db, sqlite } = app.ctx;
  const guard = { preHandler: requirePerm('product.write') };
  const sheetColumns = COLUMNS.map((c) => ({ header: c.header, key: c.header, width: 'width' in c ? c.width : 14 }));

  app.get('/api/products/template.xlsx', guard, async (_req, reply) => {
    const wb = new ExcelJS.Workbook();
    addSheet(wb, 'Products', sheetColumns, [
      { code: 'P-001', barcode: '', name_en: 'PVC Pipe 1/2"', name_ur: 'پی وی سی پائپ', aliases: 'pipe paip', category: 'Pipes', brand: 'Beta', size: '1/2"', unit: 'foot', pack_unit: 'length', pack_qty: 13, cost_price: 30, retail_price: 40, plumber_price: 37, wholesale_price: 35, min_stock: 100, stock: 650 },
      { code: 'W-1.5', name_en: 'Wire 1.5mm', name_ur: 'تار', aliases: 'taar', category: 'Wires', brand: 'Pakistan Cables', size: '1.5mm', unit: 'metre', pack_unit: 'coil', pack_qty: 90, cost_price: 55, retail_price: 70, plumber_price: 66, wholesale_price: 62, min_stock: 180, stock: 900 },
    ]);
    return sendWorkbook(reply, wb, 'products-template.xlsx');
  });

  app.get('/api/products/export.xlsx', guard, async (_req, reply) => {
    const rows = listProducts(db).map((p) => ({
      code: p.code,
      barcode: p.barcode ?? '',
      name_en: p.nameEn,
      name_ur: p.nameUr,
      aliases: p.aliases,
      category: p.categoryName ?? '',
      brand: p.brand,
      size: p.size,
      color: p.color,
      unit: p.unit,
      pack_unit: p.packUnit ?? '',
      pack_qty: p.packQty,
      cost_price: p.costPrice / 100,
      retail_price: p.retailPrice / 100,
      plumber_price: p.plumberPrice / 100,
      wholesale_price: p.wholesalePrice / 100,
      min_stock: p.minStock,
      stock: p.stock,
    }));
    const wb = new ExcelJS.Workbook();
    addSheet(wb, 'Products', sheetColumns, rows);
    return sendWorkbook(reply, wb, `products-${new Date().toISOString().slice(0, 10)}.xlsx`);
  });

  app.post('/api/products/import', guard, async (req) => {
    const file = await req.file();
    if (!file) throw badRequest('NO_FILE', 'Choose an Excel file first.');
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(await file.toBuffer());
    } catch {
      throw badRequest('IMPORT_BAD_FILE', 'This is not an Excel (.xlsx) file.');
    }
    const ws = wb.worksheets[0];
    if (!ws) throw badRequest('IMPORT_BAD_FILE', 'This is not an Excel (.xlsx) file.');
    return importProducts(db, sqlite, ws, actorOf(req));
  });
}
