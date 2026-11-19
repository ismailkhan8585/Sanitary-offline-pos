import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf, requirePerm } from '../lib/auth';
import { getSetting, setSetting } from '../lib/settings';
import { logActivity } from '../lib/activity';
import { AppError, badRequest } from '../lib/errors';
import { licenceStatus, readLicenceKey, seenKey } from '../lib/licence';

/** Writes still allowed without a licence, so Admin can activate, log in and save backups. */
const ALWAYS_ALLOWED = ['/api/auth/', '/api/licence', '/api/backup/', '/api/health'];

export function licenceRoutes(app: FastifyInstance, hwid: string, publicKey?: string): void {
  const { db } = app.ctx;
  if (!getSetting(db, seenKey(hwid))) setSetting(db, seenKey(hwid), String(Date.now()));

  app.addHook('preHandler', async (req) => {
    if (req.method === 'GET' || !req.url.startsWith('/api/')) return;
    if (ALWAYS_ALLOWED.some((p) => req.url.startsWith(p))) return;
    const lic = licenceStatus(db, hwid, Date.now(), publicKey);
    if (lic.status === 'expired') {
      throw new AppError(402, 'LICENCE_EXPIRED', `Licence needed. Give this code to support: ${hwid}`, { hardwareId: hwid });
    }
  });

  app.get('/api/licence', { config: { public: true } }, async () => licenceStatus(db, hwid, Date.now(), publicKey));

  app.post('/api/licence', { preHandler: requirePerm('settings') }, async (req) => {
    const { key } = z.object({ key: z.string().trim().min(10).max(2000) }).parse(req.body);
    const lic = readLicenceKey(key, hwid, publicKey);
    if (!lic.valid) throw badRequest('LICENCE_INVALID', 'This licence key is not valid for this PC.');
    setSetting(db, 'licence_key', key);
    logActivity(db, actorOf(req), 'licence.activate', { expiresAt: lic.expiresAt });
    return licenceStatus(db, hwid, Date.now(), publicKey);
  });
}
