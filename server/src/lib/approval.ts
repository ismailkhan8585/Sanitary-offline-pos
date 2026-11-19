import type { DB } from '../db';
import { approvals } from '../db/schema';
import { AppError } from './errors';
import { findAdminByPin } from './admin-pin';
import { createLimiter } from './limiter';
import type { AuthInfo } from './auth';

/** A rule the cashier's request breaks; needs an Admin PIN on the same screen. */
export interface Violation {
  action: 'discount_limit' | 'below_cost' | 'zero_stock' | 'credit_limit' | 'return_limit' | 'expense_limit' | 'rate_change';
  details: Record<string, unknown>;
}

const limiter = createLimiter(5, 60_000);

/**
 * Admins pass. A cashier with violations needs `adminPin`: without it the request fails with
 * APPROVAL_REQUIRED (listing the reasons); with a right PIN each approval is saved in `approvals`.
 * Call inside the action's transaction so approvals are saved only if the action succeeds.
 */
export function checkApproval(db: DB, user: AuthInfo, violations: Violation[], adminPin: string | undefined): void {
  if (violations.length === 0 || user.role === 'admin') return;
  if (!adminPin) {
    throw new AppError(403, 'APPROVAL_REQUIRED', 'Admin approval is needed.', { reasons: violations.map((v) => v.action), details: violations });
  }
  const key = `approval:${user.userId}`;
  limiter.check(key);
  const admin = findAdminByPin(db, adminPin);
  if (!admin) {
    limiter.fail(key);
    throw new AppError(403, 'WRONG_ADMIN_PIN', 'Wrong Admin PIN.');
  }
  limiter.reset(key);
  for (const v of violations) {
    db.insert(approvals).values({ action: v.action, requestedBy: user.userId, approvedBy: admin.id, details: JSON.stringify(v.details) }).run();
  }
}
