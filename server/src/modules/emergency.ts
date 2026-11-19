import type { FastifyInstance } from 'fastify';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { devices, sales, users } from '../db/schema';
import { actorOf, requirePerm } from '../lib/auth';
import { transaction } from '../lib/tx';
import { prepareSale, saleItemInput, writeSale } from './sales/service';

const billInput = z.object({
  billNo: z.string().regex(/^E-[A-Z]-\d{5}$/),
  createdAt: z.number().int().positive(),
  userId: z.number().int().nullable().default(null),
  items: z.array(saleItemInput).min(1),
  billDiscount: z.number().int().min(0).default(0),
  paid: z.number().int().min(0),
});
const uploadInput = z.object({ bills: z.array(billInput).max(500) });

/**
 * Bills the counter app saved while the server was down. Each keeps its E- number and time;
 * uploading twice is safe (existing numbers are skipped). No approvals: the shop had to keep selling.
 */
export function emergencyRoutes(app: FastifyInstance): void {
  const { db, sqlite } = app.ctx;

  /** Highest E- number the server has for this counter, so a reinstalled counter never reuses one. */
  app.get('/api/emergency/last', { preHandler: requirePerm('sale') }, async (req) => {
    const { deviceId } = actorOf(req);
    const device = deviceId ? db.select().from(devices).where(eq(devices.id, deviceId)).get() : undefined;
    if (!device) return { last: 0 };
    const pattern = `E-${device.billPrefix}-%`;
    const row = db.get<{ last: number | null }>(sql`SELECT max(CAST(substr(bill_no, 5) AS INTEGER)) AS last FROM sales WHERE bill_no LIKE ${pattern}`);
    return { last: row?.last ?? 0 };
  });

  app.post('/api/emergency/upload', { preHandler: requirePerm('sale') }, async (req) => {
    const { bills } = uploadInput.parse(req.body);
    const uploader = actorOf(req);
    const result = { uploaded: [] as string[], skipped: [] as string[], failed: [] as { billNo: string; message: string }[] };
    for (const bill of bills) {
      if (db.select({ id: sales.id }).from(sales).where(eq(sales.billNo, bill.billNo)).get()) {
        result.skipped.push(bill.billNo);
        continue;
      }
      try {
        transaction(sqlite, () => {
          const maker = bill.userId ? db.select({ id: users.id }).from(users).where(eq(users.id, bill.userId)).get() : undefined;
          const actor = { userId: maker?.id ?? uploader.userId, deviceId: uploader.deviceId };
          const input = {
            status: 'done' as const,
            customerId: null,
            plumberId: null,
            priceTier: 'retail' as const,
            items: bill.items,
            billDiscount: bill.billDiscount,
            paymentMethod: 'cash' as const,
            paid: bill.paid,
          };
          writeSale(db, input, prepareSale(db, input), actor, { billNo: bill.billNo, createdAt: bill.createdAt });
        });
        result.uploaded.push(bill.billNo);
      } catch (e) {
        result.failed.push({ billNo: bill.billNo, message: e instanceof Error ? e.message : String(e) });
      }
    }
    return result;
  });
}
