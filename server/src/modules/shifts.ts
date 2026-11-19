import type { FastifyInstance } from 'fastify';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../db';
import { devices, shifts, users } from '../db/schema';
import { actorOf, auth, requirePerm } from '../lib/auth';
import { logActivity } from '../lib/activity';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { transaction } from '../lib/tx';
import { can } from '../shared/permissions';

export interface ShiftSummary {
  salesCount: number;
  salesTotal: number;
  /** Money received on bills, per payment method. */
  byMethod: Record<string, number>;
  udhaarGiven: number;
  cashSales: number;
  paymentsIn: number;
  paymentsOut: number;
  expenses: number;
  refunds: number;
  challanAdvances: number;
  supplierPaid: number;
  supplierRefunds: number;
  expected: number;
}

/** Cash that should be in the drawer: opening + every cash movement by this cashier in the window. */
export function shiftSummary(db: DB, userId: number, deviceId: number | null, opening: number, from: number, to: number): ShiftSummary {
  const one = (q: ReturnType<typeof sql>) => db.get<{ v: number }>(q)?.v ?? 0;
  const deviceCond = deviceId ? sql`AND device_id = ${deviceId}` : sql``;
  const methods = db.all<{ method: string; paid: number; count: number; total: number; due: number }>(sql`
    SELECT payment_method AS method, sum(paid) AS paid, count(*) AS count, sum(total) AS total, sum(due) AS due FROM sales
    WHERE user_id = ${userId} ${deviceCond} AND status = 'done' AND created_at BETWEEN ${from} AND ${to}
    GROUP BY payment_method`);
  const byMethod = Object.fromEntries(methods.map((m) => [m.method, m.paid]));
  const s: Omit<ShiftSummary, 'expected'> = {
    salesCount: methods.reduce((a, m) => a + m.count, 0),
    salesTotal: methods.reduce((a, m) => a + m.total, 0),
    byMethod,
    udhaarGiven: methods.reduce((a, m) => a + m.due, 0),
    cashSales: byMethod.cash ?? 0,
    paymentsIn: one(sql`SELECT sum(amount) AS v FROM payments WHERE user_id = ${userId} AND method = 'cash' AND direction = 'in' AND created_at BETWEEN ${from} AND ${to}`),
    paymentsOut: one(sql`SELECT sum(amount) AS v FROM payments WHERE user_id = ${userId} AND method = 'cash' AND direction = 'out' AND created_at BETWEEN ${from} AND ${to}`),
    expenses: one(sql`SELECT sum(amount) AS v FROM expenses WHERE user_id = ${userId} AND method = 'cash' AND created_at BETWEEN ${from} AND ${to}`),
    refunds: one(sql`SELECT sum(total - restock_charge) AS v FROM returns WHERE user_id = ${userId} AND refund_type = 'cash' AND created_at BETWEEN ${from} AND ${to}`),
    challanAdvances: one(sql`SELECT sum(json_extract(details, '$.advance')) AS v FROM activity_log WHERE user_id = ${userId} AND action = 'challan.create' AND created_at BETWEEN ${from} AND ${to}`),
    supplierPaid: one(sql`SELECT sum(paid) AS v FROM purchases WHERE user_id = ${userId} AND is_return = 0 AND payment_method = 'cash' AND created_at BETWEEN ${from} AND ${to}`),
    supplierRefunds: one(sql`SELECT sum(paid) AS v FROM purchases WHERE user_id = ${userId} AND is_return = 1 AND payment_method = 'cash' AND created_at BETWEEN ${from} AND ${to}`),
  };
  const expected =
    opening + s.cashSales + s.paymentsIn - s.paymentsOut - s.expenses - s.refunds + s.challanAdvances - s.supplierPaid + s.supplierRefunds;
  return { ...s, expected };
}

const idParam = z.object({ id: z.coerce.number().int() });
const openInput = z.object({ openingCash: z.number().int().min(0) });
const closeInput = z.object({ closingCash: z.number().int().min(0) });

/** onClose runs after a shift closes (the server takes a backup then). */
export function shiftRoutes(app: FastifyInstance, onClose: (shiftId: number) => void): void {
  const { db, sqlite } = app.ctx;
  const guard = { preHandler: requirePerm('shift.own') };

  const openShiftOf = (userId: number) =>
    db
      .select()
      .from(shifts)
      .where(and(eq(shifts.userId, userId), isNull(shifts.closedAt)))
      .get();

  const withSummary = (s: typeof shifts.$inferSelect) => ({
    ...s,
    summary: shiftSummary(db, s.userId, s.deviceId, s.openingCash, s.openedAt, s.closedAt ?? Date.now()),
  });

  app.get('/api/shifts/current', guard, async (req) => {
    const open = openShiftOf(auth(req).userId);
    return open ? withSummary(open) : null;
  });

  app.post('/api/shifts/open', guard, async (req) => {
    const { openingCash } = openInput.parse(req.body);
    const actor = actorOf(req);
    return transaction(sqlite, () => {
      if (openShiftOf(actor.userId!)) throw badRequest('SHIFT_OPEN', 'Your shift is already open.');
      const s = db.insert(shifts).values({ userId: actor.userId!, deviceId: actor.deviceId, openingCash }).returning().get();
      logActivity(db, actor, 'shift.open', { id: s.id, openingCash });
      return withSummary(s);
    });
  });

  app.post('/api/shifts/close', guard, async (req) => {
    const { closingCash } = closeInput.parse(req.body);
    const actor = actorOf(req);
    const closed = transaction(sqlite, () => {
      const open = openShiftOf(actor.userId!);
      if (!open) throw badRequest('NO_SHIFT', 'No open shift. Open your shift first.');
      const now = Date.now();
      const { expected } = shiftSummary(db, open.userId, open.deviceId, open.openingCash, open.openedAt, now);
      const s = db
        .update(shifts)
        .set({ closedAt: now, closingCash, expectedCash: expected, difference: closingCash - expected })
        .where(eq(shifts.id, open.id))
        .returning()
        .get();
      logActivity(db, actor, 'shift.close', { id: s.id, closingCash, expected, difference: s.difference });
      return s;
    });
    onClose(closed.id);
    return withSummary(closed);
  });

  /** Admin sees every shift; a cashier only their own. */
  app.get('/api/shifts', guard, async (req) => {
    const user = auth(req);
    return db
      .select({ s: shifts, userName: users.name, deviceName: devices.name })
      .from(shifts)
      .leftJoin(users, eq(users.id, shifts.userId))
      .leftJoin(devices, eq(devices.id, shifts.deviceId))
      .where(can(user.role, 'shift.all') ? undefined : eq(shifts.userId, user.userId))
      .orderBy(desc(shifts.id))
      .limit(200)
      .all()
      .map((r) => ({ ...r.s, userName: r.userName, deviceName: r.deviceName }));
  });

  app.get('/api/shifts/:id', guard, async (req) => {
    const { id } = idParam.parse(req.params);
    const user = auth(req);
    const s = db.select().from(shifts).where(eq(shifts.id, id)).get();
    if (!s) throw notFound('Shift');
    if (s.userId !== user.userId && !can(user.role, 'shift.all')) throw forbidden();
    const names = db
      .select({ userName: users.name })
      .from(users)
      .where(eq(users.id, s.userId))
      .get();
    return { ...withSummary(s), userName: names?.userName ?? '' };
  });
}
