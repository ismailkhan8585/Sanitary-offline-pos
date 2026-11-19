import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { z } from 'zod';
import { expenses, paymentMethods, users } from '../db/schema';
import { actorOf, auth, requirePerm } from '../lib/auth';
import { logActivity } from '../lib/activity';
import { checkApproval } from '../lib/approval';
import { transaction } from '../lib/tx';

const expenseInput = z.object({
  category: z.string().trim().min(1).max(40),
  amount: z.number().int().positive(),
  method: z.enum(paymentMethods).refine((m) => m !== 'credit', 'Choose how it was paid'),
  note: z.string().trim().max(200).default(''),
  adminPin: z.string().max(8).optional(),
});
const listQuery = z.object({ from: z.coerce.number().int().optional(), to: z.coerce.number().int().optional() });

export function expenseRoutes(app: FastifyInstance): void {
  const { db, sqlite } = app.ctx;
  const guard = { preHandler: requirePerm('expense') };

  app.post('/api/expenses', guard, async (req) => {
    const { adminPin, ...body } = expenseInput.parse(req.body);
    const user = auth(req);
    const actor = actorOf(req);
    return transaction(sqlite, () => {
      const over = body.amount > user.expenseLimit ? [{ action: 'expense_limit' as const, details: { amount: body.amount, limit: user.expenseLimit, category: body.category } }] : [];
      checkApproval(db, user, over, adminPin);
      const created = db
        .insert(expenses)
        .values({ ...body, userId: user.userId })
        .returning()
        .get();
      logActivity(db, actor, 'expense.create', created);
      return created;
    });
  });

  /** Cashiers see their own expenses; Admin sees all. */
  app.get('/api/expenses', guard, async (req) => {
    const q = listQuery.parse(req.query);
    const user = auth(req);
    return db
      .select({
        id: expenses.id,
        category: expenses.category,
        amount: expenses.amount,
        method: expenses.method,
        note: expenses.note,
        createdAt: expenses.createdAt,
        userName: users.name,
      })
      .from(expenses)
      .leftJoin(users, eq(users.id, expenses.userId))
      .where(
        and(
          q.from ? gte(expenses.createdAt, q.from) : undefined,
          q.to ? lte(expenses.createdAt, q.to) : undefined,
          user.role === 'admin' ? undefined : eq(expenses.userId, user.userId),
        ),
      )
      .orderBy(desc(expenses.id))
      .limit(500)
      .all();
  });

  app.get('/api/expenses/categories', guard, async () => {
    const used = db.selectDistinct({ category: expenses.category }).from(expenses).all().map((r) => r.category);
    return [...new Set(['Tea / food', 'Electricity', 'Rent', 'Salary', 'Transport', 'Repair', 'Other', ...used])];
  });
}
