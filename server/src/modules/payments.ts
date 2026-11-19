import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../db';
import { customers, partyTypes, paymentMethods, payments, plumbers, suppliers } from '../db/schema';
import { actorOf, auth } from '../lib/auth';
import { logActivity } from '../lib/activity';
import { forbidden, notFound } from '../lib/errors';
import { transaction } from '../lib/tx';
import { customerBalance, plumberBalance, supplierBalance } from '../lib/ledger';
import { can } from '../shared/permissions';

const paymentInput = z.object({
  partyType: z.enum(partyTypes),
  partyId: z.number().int(),
  amount: z.number().int().positive(),
  method: z.enum(paymentMethods).refine((m) => m !== 'credit', 'Udhaar is not a payment method here'),
  direction: z.enum(['in', 'out']),
  note: z.string().trim().max(200).default(''),
});

export function partyBalance(db: DB, type: (typeof partyTypes)[number], id: number): number {
  return type === 'customer' ? customerBalance(db, id) : type === 'supplier' ? supplierBalance(db, id) : plumberBalance(db, id);
}

function partyExists(db: DB, type: (typeof partyTypes)[number], id: number): boolean {
  const table = type === 'customer' ? customers : type === 'supplier' ? suppliers : plumbers;
  return Boolean(db.select({ id: table.id }).from(table).where(eq(table.id, id)).get());
}

export function paymentRoutes(app: FastifyInstance): void {
  const { db, sqlite } = app.ctx;

  /** Customer money coming in may be taken by cashiers; every other payment needs Admin. */
  app.post('/api/payments', async (req) => {
    const body = paymentInput.parse(req.body);
    const isReceipt = body.partyType === 'customer' && body.direction === 'in';
    if (!can(auth(req).role, isReceipt ? 'payment.receive' : 'payment.out')) throw forbidden();
    if (!partyExists(db, body.partyType, body.partyId)) throw notFound(body.partyType);
    const actor = actorOf(req);
    return transaction(sqlite, () => {
      const payment = db
        .insert(payments)
        .values({ ...body, userId: actor.userId! })
        .returning()
        .get();
      logActivity(db, actor, `payment.${body.partyType}.${body.direction}`, payment);
      return { payment, balance: partyBalance(db, body.partyType, body.partyId) };
    });
  });
}
