import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { actorOf, auth, requirePerm } from '../../lib/auth';
import { getSetting, setSetting } from '../../lib/settings';
import { logActivity } from '../../lib/activity';
import { AppError, badRequest } from '../../lib/errors';
import { findAdminByPin } from '../../lib/admin-pin';
import type { BackupService } from './service';

const settingsInput = z
  .object({
    backupDir: z.string().trim().max(260),
    replicaPath: z.string().trim().max(260),
    litestreamPath: z.string().trim().max(260),
    cloudFolder: z.string().trim().max(260),
  })
  .partial();
const KEYS = { backupDir: 'backup_dir', replicaPath: 'replica_path', litestreamPath: 'litestream_path', cloudFolder: 'cloud_folder' } as const;
const fileInput = z.object({ path: z.string().min(1), password: z.string().optional() });

export function backupRoutes(app: FastifyInstance, backup: BackupService, onRestoreStaged: () => void): void {
  const { db } = app.ctx;
  const guard = { preHandler: requirePerm('backup') };

  app.get('/api/backup/health', guard, async () => backup.health());

  app.get('/api/backup/settings', guard, async () => ({
    ...Object.fromEntries(Object.entries(KEYS).map(([k, key]) => [k, getSetting(db, key) ?? ''])),
    backupDir: backup.dir(),
  }));

  app.put('/api/backup/settings', guard, async (req) => {
    const body = settingsInput.parse(req.body);
    for (const [k, v] of Object.entries(body)) setSetting(db, KEYS[k as keyof typeof KEYS], v);
    logActivity(db, actorOf(req), 'backup.settings', body);
    return { ok: true };
  });

  app.post('/api/backup/password', guard, async (req) => {
    const { password } = z.object({ password: z.string() }).parse(req.body);
    backup.setPassword(password, actorOf(req));
    return { ok: true };
  });

  app.post('/api/backup/run', guard, async (req) => {
    const actor = actorOf(req);
    const { file } = backup.run('manual', actor);
    const usb = getSetting(db, 'backup_password') ? backup.copyToUsbDisk(actor) : { copied: false };
    return { file, usbDisk: usb.copied };
  });

  app.get('/api/backup/drives', guard, async () => backup.drivesInfo());

  app.post('/api/backup/prepare-usb', guard, async (req) => {
    const { root, role } = z.object({ root: z.string(), role: z.enum(['disk', 'takehome-1', 'takehome-2']) }).parse(req.body);
    backup.prepareUsb(root, role, actorOf(req));
    return { ok: true };
  });

  app.post('/api/backup/takehome', guard, async (req) => backup.copyToTakeHome(actorOf(req)));

  app.get('/api/backup/list', guard, async () => backup.list());

  app.post('/api/backup/verify', guard, async (req) => {
    const { path, password } = fileInput.parse(req.body);
    return backup.verify(path, password);
  });

  /** Admin re-types their PIN; the current data is backed up, then the server restarts on the chosen backup. */
  app.post('/api/backup/restore', guard, async (req) => {
    const { path, password, adminPin } = fileInput.extend({ adminPin: z.string() }).parse(req.body);
    const admin = findAdminByPin(db, adminPin);
    if (!admin || admin.id !== auth(req).userId) throw new AppError(403, 'WRONG_ADMIN_PIN', 'Wrong Admin PIN.');
    const result = backup.stageRestore(path, password, actorOf(req));
    setImmediate(onRestoreStaged);
    return { ...result, restarting: true };
  });

  app.post('/api/backup/upload', guard, async (req) => {
    const file = await req.file();
    if (!file) throw badRequest('NO_FILE', 'Choose a backup file first.');
    return { path: backup.saveUpload(file.filename, await file.toBuffer()) };
  });
}
