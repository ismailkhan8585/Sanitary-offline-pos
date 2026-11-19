import crypto from 'node:crypto';
import type { DB } from '.';
import { devices, settings, users } from './schema';
import { hashPin } from '../lib/pin';

export const DEFAULT_SETTINGS: Record<string, string> = {
  shop_name_en: 'Haroon Electric & Sanitary Store',
  shop_name_ur: 'ہارون الیکٹرک اینڈ سینیٹری اسٹور',
  shop_address: '',
  shop_phone: '',
  tax_pct: '0',
  receipt_footer_en: 'Thank you for shopping with us!',
  receipt_footer_ur: 'خریداری کا شکریہ!',
  receipt_width: '80',
  default_language: 'en',
  closing_time: '22:00',
};

/** Fills a fresh database with defaults. Safe to run on every start. */
export function seed(db: DB): void {
  const rows = { ...DEFAULT_SETTINGS, auth_secret: crypto.randomBytes(32).toString('hex'), installed_at: String(Date.now()) };
  for (const [key, value] of Object.entries(rows)) {
    db.insert(settings).values({ key, value }).onConflictDoNothing().run();
  }
  if (!db.select({ id: users.id }).from(users).limit(1).get()) {
    db.insert(users).values({ name: 'Admin', role: 'admin', pinHash: hashPin('1234') }).run();
  }
  if (!db.select({ id: devices.id }).from(devices).limit(1).get()) {
    db.insert(devices).values({ name: 'Counter A', billPrefix: 'A' }).run();
  }
}
