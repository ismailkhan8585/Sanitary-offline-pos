import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
import { openDatabase } from '../src/db';
import { seed } from '../src/db/seed';
import { buildApp } from '../src/app';
import { users, sales } from '../src/db/schema';
import { hashPin } from '../src/lib/pin';
import { setSetting } from '../src/lib/settings';
import { decryptFile, encryptFile } from '../src/lib/crypto-file';
import { applyPendingRestore, BackupService, integrityCheck, prune } from '../src/modules/backup/service';
import { closingPdf, monthlyWorkbook } from '../src/modules/closing';
import { licenceStatus, makeLicenceKey, readLicenceKey, seenKey } from '../src/lib/licence';
import { addProduct, call, login, migrationsDir, wire } from './helpers';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pos-bk-'));
const HWID = 'AAAA-BBBB-CCCC-DDDD';

async function backupEnv(extra: { licencePublicKey?: string } = {}) {
  const dataDir = tmp();
  const usb = tmp();
  const dbFile = path.join(dataDir, 'pos.db');
  const database = openDatabase(dbFile, migrationsDir);
  seed(database.db);
  database.db.insert(users).values({ name: 'Ali', role: 'cashier', pinHash: hashPin('1111') }).run();
  const backup = new BackupService(database.sqlite, database.db, { dataDir, dbFile, defaultBackupDir: path.join(dataDir, 'backups') }, () => [usb]);
  const onRestoreStaged = vi.fn();
  const app = buildApp(database, { hardwareId: HWID, backup, onRestoreStaged, ...extra });
  await app.ready();
  const adminToken = await login(app, 1, '1234');
  const cashierToken = await login(app, 2, '1111');
  return { app, database, backup, dataDir, dbFile, usb, adminToken, cashierToken, onRestoreStaged };
}

describe('encryption', () => {
  it('round-trips with the right password only', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'a'), 'secret data');
    encryptFile(path.join(dir, 'a'), path.join(dir, 'a.enc'), 'correct horse');
    expect(fs.readFileSync(path.join(dir, 'a.enc')).includes('secret')).toBe(false);
    decryptFile(path.join(dir, 'a.enc'), path.join(dir, 'b'), 'correct horse');
    expect(fs.readFileSync(path.join(dir, 'b'), 'utf8')).toBe('secret data');
    expect(() => decryptFile(path.join(dir, 'a.enc'), path.join(dir, 'c'), 'wrong')).toThrow(/Wrong backup password/);
  });
});

describe('backups', () => {
  it('takes checked snapshots and keeps only the newest per folder', async () => {
    const { backup, app, adminToken } = await backupEnv();
    const { file } = backup.run('hourly');
    expect(file).toContain(`${path.sep}hourly${path.sep}`);
    expect(integrityCheck(file)).toBe('ok');
    const dir = path.dirname(file);
    for (let i = 0; i < 30; i++) {
      const f = path.join(dir, `old-${i}.db`);
      fs.writeFileSync(f, '');
      fs.utimesSync(f, new Date(2020, 0, 1, 0, i), new Date(2020, 0, 1, 0, i));
    }
    prune(dir, 24);
    expect(fs.readdirSync(dir)).toHaveLength(24);
    expect(fs.existsSync(file)).toBe(true);
    const health = (await call(app, adminToken, 'GET', '/api/backup/health')).body;
    expect(health).toMatchObject({ passwordSet: false, hourly: { ok: true } });
  });

  it('copies encrypted backups to the USB disk and take-home USB', async () => {
    const { app, adminToken, usb } = await backupEnv();
    expect((await call(app, adminToken, 'POST', '/api/backup/takehome')).body.code).toBe('NO_TAKEHOME_USB');
    await call(app, adminToken, 'POST', '/api/backup/prepare-usb', { root: usb, role: 'takehome-1' });
    expect((await call(app, adminToken, 'POST', '/api/backup/takehome')).body.code).toBe('BACKUP_PASSWORD_MISSING');
    expect((await call(app, adminToken, 'POST', '/api/backup/password', { password: 'short' })).body.code).toBe('PASSWORD_SHORT');
    await call(app, adminToken, 'POST', '/api/backup/password', { password: 'shop-secret-2026' });
    await call(app, adminToken, 'POST', '/api/backup/prepare-usb', { root: usb, role: 'disk' });
    expect((await call(app, adminToken, 'POST', '/api/backup/run')).body.usbDisk).toBe(true);
    const list = (await call(app, adminToken, 'GET', '/api/backup/list')).body as { source: string; encrypted: boolean; path: string }[];
    const onUsb = list.find((e) => e.source === 'usb')!;
    expect(onUsb.encrypted).toBe(true);
    expect((await call(app, adminToken, 'POST', '/api/backup/verify', { path: onUsb.path })).body).toMatchObject({ ok: true, integrity: 'ok' });
    expect((await call(app, adminToken, 'POST', '/api/backup/verify', { path: onUsb.path, password: 'nope' })).body.code).toBe('WRONG_BACKUP_PASSWORD');
    expect((await call(app, adminToken, 'POST', '/api/backup/verify', { path: 'C:/Windows/win.ini' })).body.code).toBe('BACKUP_NOT_FOUND');

    await call(app, adminToken, 'POST', '/api/backup/prepare-usb', { root: usb, role: 'takehome-1' });
    expect((await call(app, adminToken, 'POST', '/api/backup/takehome')).body.usb).toBe(1);
    const health = (await call(app, adminToken, 'GET', '/api/backup/health')).body;
    expect(health.takeHome.ok).toBe(true);
    expect(health.usbDisk).toMatchObject({ connected: true, ok: true });
  });

  it('restores a backup: saves current data first, swaps on restart, logs it', async () => {
    const env = await backupEnv();
    const { app, adminToken, cashierToken, database, dataDir, dbFile, onRestoreStaged } = env;
    const wireId = await addProduct(app, adminToken, wire, 100);
    await call(app, adminToken, 'POST', '/api/sales', { items: [{ productId: wireId, qty: 1, unit: 'metre', rate: 7000 }], paid: 7000 });
    await call(app, adminToken, 'POST', '/api/backup/run');
    const target = (await call(app, adminToken, 'GET', '/api/backup/list')).body[0].path;
    await call(app, adminToken, 'POST', '/api/sales', { items: [{ productId: wireId, qty: 1, unit: 'metre', rate: 7000 }], paid: 7000 });

    expect((await call(app, cashierToken, 'POST', '/api/backup/restore', { path: target, adminPin: '1234' })).status).toBe(403);
    expect((await call(app, adminToken, 'POST', '/api/backup/restore', { path: target, adminPin: '0000' })).body.code).toBe('WRONG_ADMIN_PIN');
    const staged = await call(app, adminToken, 'POST', '/api/backup/restore', { path: target, adminPin: '1234' });
    expect(staged.body).toMatchObject({ ok: true, sales: 1, restarting: true });
    await new Promise((r) => setImmediate(r));
    expect(onRestoreStaged).toHaveBeenCalled();
    expect(fs.existsSync(staged.body.safety)).toBe(true);

    await app.close();
    database.sqlite.close();
    const info = applyPendingRestore(dataDir);
    expect(info?.from).toBe(target);
    const reopened = openDatabase(dbFile, migrationsDir);
    expect(reopened.db.select().from(sales).all()).toHaveLength(1);
    expect(fs.readdirSync(dataDir).some((f) => f.startsWith('pos.db.before-restore-'))).toBe(true);
    reopened.sqlite.close();
  });

  it('keeps a live replica copy when a replica folder is set', async () => {
    const { backup, database } = await backupEnv();
    const replicaDir = tmp();
    setSetting(database.db, 'replica_path', replicaDir);
    backup.replicaTick();
    expect(integrityCheck(path.join(replicaDir, 'pos-replica.db'))).toBe('ok');
    expect(backup.health().replica.ok).toBe(true);
  });
});

describe('exports', () => {
  it('makes the closing PDF and the monthly Excel', async () => {
    const { app, adminToken, database } = await backupEnv();
    const wireId = await addProduct(app, adminToken, wire, 100);
    await call(app, adminToken, 'POST', '/api/sales', { items: [{ productId: wireId, qty: 2, unit: 'metre', rate: 7000 }], paid: 14000 });
    const pdf = await closingPdf(database.db, new Date());
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    const wb = monthlyWorkbook(database.db);
    expect(wb.worksheets.map((w: ExcelJS.Worksheet) => w.name)).toEqual(['Customer balances', 'Stock', 'Supplier balances']);
    const res = await app.inject({ method: 'GET', url: `/api/reports/closing.pdf?token=${adminToken}` });
    expect(res.headers['content-type']).toBe('application/pdf');
  });
});

describe('licence', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const pub = publicKey.export({ type: 'spki', format: 'pem' }).toString();

  it('accepts a key only for this PC and before it expires', () => {
    expect(readLicenceKey(makeLicenceKey(priv, HWID, 0), HWID, pub)).toMatchObject({ valid: true, expiresAt: null });
    expect(readLicenceKey(makeLicenceKey(priv, 'OTHER', 0), HWID, pub).reason).toBe('other-pc');
    const forged = makeLicenceKey(crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), HWID, 0);
    expect(readLicenceKey(forged, HWID, pub).reason).toBe('signature');
  });

  it('runs a 30-day trial, then blocks changes until a licence is entered', async () => {
    const { app, adminToken, database } = await backupEnv({ licencePublicKey: pub });
    expect(licenceStatus(database.db, HWID, Date.now(), pub)).toMatchObject({ status: 'trial', daysLeft: 30 });
    setSetting(database.db, `hw_seen:${HWID}`, String(Date.now() - 31 * 86_400_000));
    const blocked = await call(app, adminToken, 'POST', '/api/customers', { name: 'X' });
    expect(blocked.status).toBe(402);
    expect(blocked.body.params.hardwareId).toBe(HWID);
    expect((await call(app, adminToken, 'GET', '/api/customers')).status).toBe(200);
    expect((await call(app, adminToken, 'POST', '/api/licence', { key: makeLicenceKey(priv, 'OTHER-PC', 0) })).body.code).toBe('LICENCE_INVALID');
    const ok = await call(app, adminToken, 'POST', '/api/licence', { key: makeLicenceKey(priv, HWID, Date.now() + 365 * 86_400_000) });
    expect(ok.body).toMatchObject({ status: 'active', daysLeft: 365 });
    expect((await call(app, adminToken, 'POST', '/api/customers', { name: 'X' })).status).toBe(200);
  });

  it('gives a replacement PC (after a disaster restore) its own 30 days', async () => {
    const { database } = await backupEnv({ licencePublicKey: pub });
    setSetting(database.db, 'installed_at', String(Date.now() - 400 * 86_400_000));
    setSetting(database.db, 'licence_key', makeLicenceKey(priv, 'OLD-SERVER-PC', 0));
    setSetting(database.db, seenKey('NEW-PC'), String(Date.now()));
    expect(licenceStatus(database.db, 'NEW-PC', Date.now(), pub)).toMatchObject({ status: 'trial', daysLeft: 30 });
    expect(licenceStatus(database.db, 'OLD-SERVER-PC', Date.now(), pub).status).toBe('active');
  });
});
