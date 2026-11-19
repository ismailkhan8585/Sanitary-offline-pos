import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePerm, actorOf } from '../lib/auth';
import { getAllSettings, setSetting } from '../lib/settings';
import { logActivity } from '../lib/activity';

/** Settings any screen may read before login (receipt, shop name, language). */
const PUBLIC_KEYS = [
  'shop_name_en',
  'shop_name_ur',
  'shop_address',
  'shop_phone',
  'tax_pct',
  'receipt_footer_en',
  'receipt_footer_ur',
  'receipt_width',
  'default_language',
] as const;

const editable = z
  .object({
    shop_name_en: z.string().max(80),
    shop_name_ur: z.string().max(80),
    shop_address: z.string().max(200),
    shop_phone: z.string().max(60),
    tax_pct: z.string().regex(/^\d{1,2}(\.\d{1,2})?$/),
    receipt_footer_en: z.string().max(300),
    receipt_footer_ur: z.string().max(300),
    receipt_width: z.enum(['58', '80', 'a4']),
    default_language: z.enum(['en', 'ur']),
    closing_time: z.string().regex(/^\d{2}:\d{2}$/),
  })
  .partial();

export function settingsRoutes(app: FastifyInstance): void {
  const { db } = app.ctx;

  app.get('/api/settings/public', { config: { public: true } }, async () => {
    const all = getAllSettings(db);
    return Object.fromEntries(PUBLIC_KEYS.map((k) => [k, all[k] ?? '']));
  });

  app.get('/api/settings', { preHandler: requirePerm('settings') }, async () => {
    const all = getAllSettings(db);
    return Object.fromEntries(Object.keys(editable.shape).map((k) => [k, all[k] ?? '']));
  });

  app.put('/api/settings', { preHandler: requirePerm('settings') }, async (req) => {
    const body = editable.parse(req.body);
    for (const [key, value] of Object.entries(body)) setSetting(db, key, value);
    logActivity(db, actorOf(req), 'settings.update', body);
    return { ok: true };
  });
}
