import { and, eq } from 'drizzle-orm';
import type { DB } from '../db';
import { users } from '../db/schema';
import { verifyPin } from './pin';

/** Returns the active admin whose PIN matches, if any. */
export function findAdminByPin(db: DB, pin: string) {
  const admins = db
    .select()
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.active, true)))
    .all();
  return admins.find((a) => verifyPin(pin, a.pinHash));
}
