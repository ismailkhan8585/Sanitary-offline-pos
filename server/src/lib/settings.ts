import { eq } from 'drizzle-orm';
import type { DB } from '../db';
import { settings } from '../db/schema';

export function getSetting(db: DB, key: string): string | undefined {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value;
}

export function setSetting(db: DB, key: string, value: string): void {
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } }).run();
}

export function getAllSettings(db: DB): Record<string, string> {
  return Object.fromEntries(db.select().from(settings).all().map((s) => [s.key, s.value]));
}
