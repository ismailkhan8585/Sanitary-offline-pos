import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import Database from 'better-sqlite3';
import type { DB } from '../../db';
import { getSetting, setSetting } from '../../lib/settings';
import { logActivity, type Actor } from '../../lib/activity';
import { AppError, badRequest } from '../../lib/errors';
import { decryptFile, encryptFile, isEncryptedBackup } from '../../lib/crypto-file';

export type BackupKind = 'hourly' | 'shift' | 'daily' | 'manual' | 'pre-restore';
type Tier = 'hourly' | 'daily' | 'monthly' | 'yearly' | 'manual';

/** How many copies each folder keeps (yearly: forever). */
const KEEP: Record<Tier, number> = { hourly: 24, daily: 30, monthly: 12, yearly: Infinity, manual: 20 };
const USB_DISK_MARKER = 'HAROON-POS-BACKUP-DISK.txt';
const takeHomeMarker = (n: 1 | 2) => `HAROON-POS-TAKEHOME-${n}.txt`;
const USB_FOLDER = 'HaroonPOS-Backups';
const DAY = 86_400_000;

export interface BackupPaths {
  dataDir: string;
  dbFile: string;
  defaultBackupDir: string;
}

export interface BackupEntry {
  path: string;
  source: 'hourly' | 'daily' | 'monthly' | 'yearly' | 'manual' | 'usb' | 'takehome' | 'replica' | 'cloud' | 'uploaded';
  name: string;
  size: number;
  createdAt: number;
  encrypted: boolean;
}

const stamp = (d = new Date()) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** Every backup copy is taken with VACUUM INTO (never by copying the live file) and checked with PRAGMA integrity_check. */
export class BackupService {
  private litestream: ChildProcess | null = null;

  constructor(
    private sqlite: Database.Database,
    private db: DB,
    private paths: BackupPaths,
    /** Drive roots to look for USB disks, e.g. ["E:/", "F:/"]. Injectable for tests. */
    private drives: () => string[] = windowsDrives,
  ) {}

  dir(): string {
    return getSetting(this.db, 'backup_dir') || this.paths.defaultBackupDir;
  }

  private status(key: string, value: number | string = Date.now()) {
    setSetting(this.db, `bk:${key}`, String(value));
  }

  private last(key: string): number | null {
    const v = getSetting(this.db, `bk:${key}`);
    return v ? Number(v) : null;
  }

  private password(): string {
    const pw = getSetting(this.db, 'backup_password');
    if (!pw) throw new AppError(400, 'BACKUP_PASSWORD_MISSING', 'Set a backup password first (Backup page).');
    return pw;
  }

  setPassword(password: string, actor: Actor) {
    if (password.length < 8) throw badRequest('PASSWORD_SHORT', 'Backup password must be at least 8 characters.');
    setSetting(this.db, 'backup_password', password);
    logActivity(this.db, actor, 'backup.password_set');
  }

  /** Consistent copy of the live database, checked before it counts as a backup. */
  snapshot(dest: string): void {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.part`;
    fs.rmSync(tmp, { force: true });
    this.sqlite.prepare('VACUUM INTO ?').run(tmp);
    const result = integrityCheck(tmp);
    if (result !== 'ok') {
      fs.rmSync(tmp, { force: true });
      throw new AppError(500, 'BACKUP_DAMAGED', `Backup copy failed its check: ${result}`);
    }
    fs.renameSync(tmp, dest);
  }

  run(kind: BackupKind, actor: Actor = { userId: null, deviceId: null }): { file: string } {
    const tier: Tier = kind === 'hourly' || kind === 'shift' ? 'hourly' : kind === 'daily' ? 'daily' : 'manual';
    const now = new Date();
    const file = path.join(this.dir(), tier, `pos-${stamp(now)}-${kind}.db`);
    try {
      this.snapshot(file);
      prune(path.join(this.dir(), tier), KEEP[tier]);
      if (kind === 'daily') {
        if (now.getDate() === 1) this.copyTier(file, 'monthly');
        if (now.getDate() === 1 && now.getMonth() === 0) this.copyTier(file, 'yearly');
      }
      this.status(`last_${tier}`);
      logActivity(this.db, actor, `backup.${kind}`, { file, integrity: 'ok', size: fs.statSync(file).size });
      return { file };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.status('last_error', `${now.toISOString()} ${kind}: ${message}`);
      logActivity(this.db, actor, 'backup.failed', { kind, message });
      throw e;
    }
  }

  private copyTier(file: string, tier: 'monthly' | 'yearly') {
    const dest = path.join(this.dir(), tier, path.basename(file).replace('-daily', `-${tier}`));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
    prune(path.dirname(dest), KEEP[tier]);
    this.status(`last_${tier}`);
  }

  private latestLocal(): string {
    const latest = this.list().find((e) => ['hourly', 'daily', 'manual'].includes(e.source) && !e.encrypted);
    return latest?.path ?? this.run('manual').file;
  }

  /** Drives that can hold USB copies: never the drive with the backup folder or the live data (rule 3-2-1). */
  private usbDrives(): string[] {
    const letter = (p: string) => /^([A-Za-z]):/.exec(path.resolve(p))?.[1]?.toUpperCase();
    const taken = new Set([letter(this.dir()), letter(this.paths.dataDir)]);
    return this.drives().filter((root) => !(/^[A-Za-z]:[/]?$/.test(root) && taken.has(root[0].toUpperCase())));
  }

  private findDrive(marker: string): string | null {
    return this.usbDrives().find((root) => fs.existsSync(path.join(root, marker))) ?? null;
  }

  /** External USB hard disk kept connected at the shop: an encrypted copy every closing. */
  copyToUsbDisk(actor: Actor = { userId: null, deviceId: null }): { copied: boolean; file?: string } {
    const root = this.findDrive(USB_DISK_MARKER);
    if (!root) return { copied: false };
    const dest = path.join(root, USB_FOLDER, `${path.basename(this.latestLocal())}.enc`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    encryptFile(this.latestLocal(), dest, this.password());
    prune(path.dirname(dest), 60);
    this.status('last_usb_disk');
    logActivity(this.db, actor, 'backup.usb_disk', { file: dest });
    return { copied: true, file: dest };
  }

  /** Take-home USB (two that rotate): a fresh encrypted copy now. */
  copyToTakeHome(actor: Actor): { usb: 1 | 2; file: string } {
    for (const n of [1, 2] as const) {
      const root = this.findDrive(takeHomeMarker(n));
      if (!root) continue;
      const fresh = this.run('manual', actor).file;
      const dest = path.join(root, USB_FOLDER, `${path.basename(fresh)}.enc`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      encryptFile(fresh, dest, this.password());
      prune(path.dirname(dest), 10);
      this.status(`last_takehome_${n}`);
      logActivity(this.db, actor, 'backup.takehome', { usb: n, file: dest });
      return { usb: n, file: dest };
    }
    throw new AppError(400, 'NO_TAKEHOME_USB', 'Take-home USB not found. Plug it in (prepare it once on this page).');
  }

  /** Writes the marker file that tells the POS what a drive is for. */
  prepareUsb(root: string, role: 'disk' | 'takehome-1' | 'takehome-2', actor: Actor) {
    if (!this.usbDrives().includes(root)) throw badRequest('NO_DRIVE', 'That drive is not connected.');
    const marker = role === 'disk' ? USB_DISK_MARKER : takeHomeMarker(role === 'takehome-1' ? 1 : 2);
    fs.writeFileSync(path.join(root, marker), `This drive holds Haroon POS backups (${role}). Do not delete this file.\r\n`);
    fs.mkdirSync(path.join(root, USB_FOLDER), { recursive: true });
    logActivity(this.db, actor, 'backup.prepare_usb', { root, role });
  }

  drivesInfo() {
    return this.usbDrives().map((root) => ({
      root,
      role: fs.existsSync(path.join(root, USB_DISK_MARKER))
        ? 'disk'
        : fs.existsSync(path.join(root, takeHomeMarker(1)))
          ? 'takehome-1'
          : fs.existsSync(path.join(root, takeHomeMarker(2)))
            ? 'takehome-2'
            : null,
    }));
  }

  /** Optional: encrypted copy into a Google Drive / OneDrive folder; it uploads whenever internet is available. */
  copyToCloud(): boolean {
    const folder = getSetting(this.db, 'cloud_folder');
    if (!folder || !fs.existsSync(folder)) return false;
    const latest = this.latestLocal();
    encryptFile(latest, path.join(folder, `${path.basename(latest)}.enc`), this.password());
    prune(folder, 30);
    this.status('last_cloud');
    return true;
  }

  /**
   * Live replica on a second PC / NAS. With Litestream installed it streams every change;
   * otherwise a checked copy is written every few minutes. Either way the second PC can be made the server.
   */
  replicaTick(): void {
    const target = getSetting(this.db, 'replica_path');
    if (!target) return;
    const exe = getSetting(this.db, 'litestream_path');
    if (exe && fs.existsSync(exe)) {
      if (this.litestream && this.litestream.exitCode === null) {
        this.status('last_replica');
        return;
      }
      const cfg = path.join(this.paths.dataDir, 'litestream.yml');
      fs.writeFileSync(cfg, `dbs:\n  - path: ${JSON.stringify(this.paths.dbFile)}\n    replicas:\n      - type: file\n        path: ${JSON.stringify(path.join(target, 'litestream'))}\n`);
      this.litestream = spawn(exe, ['replicate', '-config', cfg], { stdio: 'ignore', windowsHide: true });
      this.litestream.on('error', (e) => this.status('last_error', `litestream: ${e.message}`));
      return;
    }
    try {
      this.snapshot(path.join(target, 'pos-replica.db'));
      this.status('last_replica');
    } catch (e) {
      this.status('last_error', `replica: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  stopReplica() {
    this.litestream?.kill();
  }

  /** All backups the Restore screen can offer, newest first. */
  list(): BackupEntry[] {
    const out: BackupEntry[] = [];
    const scan = (dir: string, source: BackupEntry['source']) => {
      if (!fs.existsSync(dir)) return;
      for (const name of fs.readdirSync(dir)) {
        if (!/\.db(\.enc)?$/.test(name)) continue;
        const p = path.join(dir, name);
        const st = fs.statSync(p);
        out.push({ path: p, source, name, size: st.size, createdAt: st.mtimeMs, encrypted: name.endsWith('.enc') });
      }
    };
    for (const tier of ['hourly', 'daily', 'monthly', 'yearly', 'manual', 'uploaded'] as const) scan(path.join(this.dir(), tier), tier);
    for (const d of this.drivesInfo()) if (d.role) scan(path.join(d.root, USB_FOLDER), d.role === 'disk' ? 'usb' : 'takehome');
    const replica = getSetting(this.db, 'replica_path');
    if (replica) scan(replica, 'replica');
    const cloud = getSetting(this.db, 'cloud_folder');
    if (cloud) scan(cloud, 'cloud');
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  private known(file: string): BackupEntry {
    const entry = this.list().find((e) => e.path === file);
    if (!entry) throw badRequest('BACKUP_NOT_FOUND', 'Backup file not found. Refresh the list.');
    return entry;
  }

  /** Opens a backup (decrypting a copy if needed) and checks it is a healthy POS database. */
  verify(file: string, password?: string) {
    const entry = this.known(file);
    return withPlainCopy(entry, password ?? getSetting(this.db, 'backup_password') ?? '', (plain) => inspect(plain));
  }

  /** Prepares a restore: saves the current data first, then the server swaps files on restart. */
  stageRestore(file: string, password: string | undefined, actor: Actor) {
    const entry = this.known(file);
    const pending = path.join(this.paths.dataDir, 'pos.db.restore-pending');
    const info = withPlainCopy(entry, password ?? getSetting(this.db, 'backup_password') ?? '', (plain) => {
      const check = inspect(plain);
      if (!check.ok) throw new AppError(400, 'BACKUP_DAMAGED', `Backup failed its check: ${check.integrity}`);
      fs.copyFileSync(plain, pending);
      return check;
    });
    const safety = this.run('pre-restore', actor).file;
    fs.writeFileSync(path.join(this.paths.dataDir, 'restore-info.json'), JSON.stringify({ from: entry.path, safety, by: actor.userId, at: Date.now(), check: info }));
    logActivity(this.db, actor, 'backup.restore_staged', { from: entry.path, safety });
    return { ...info, safety };
  }

  saveUpload(name: string, data: Buffer): string {
    const clean = path.basename(name).replace(/[^\w.-]/g, '_');
    if (!/\.db(\.enc)?$/.test(clean)) throw badRequest('BACKUP_BAD_FILE', 'Choose a .db or .db.enc backup file.');
    const dest = path.join(this.dir(), 'uploaded', clean);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
    return dest;
  }

  health() {
    const now = Date.now();
    const lastHourly = this.last('last_hourly');
    const lastUsb = this.last('last_usb_disk');
    const take1 = this.last('last_takehome_1');
    const take2 = this.last('last_takehome_2');
    const lastTakeHome = Math.max(take1 ?? 0, take2 ?? 0) || null;
    const replicaPath = getSetting(this.db, 'replica_path');
    const lastReplica = this.last('last_replica');
    const drives = this.drivesInfo();
    return {
      backupDir: this.dir(),
      passwordSet: Boolean(getSetting(this.db, 'backup_password')),
      hourly: { last: lastHourly, ok: lastHourly !== null && now - lastHourly < 2 * 3_600_000 },
      daily: { last: this.last('last_daily') },
      replica: {
        configured: Boolean(replicaPath),
        mode: getSetting(this.db, 'litestream_path') ? 'litestream' : 'copy',
        last: lastReplica,
        ok: Boolean(replicaPath) && lastReplica !== null && now - lastReplica < 15 * 60_000,
      },
      usbDisk: { connected: drives.some((d) => d.role === 'disk'), last: lastUsb, ok: lastUsb !== null && now - lastUsb < 2 * DAY },
      takeHome: { usb1: take1, usb2: take2, last: lastTakeHome, ok: lastTakeHome !== null && now - lastTakeHome < 7 * DAY },
      cloud: { configured: Boolean(getSetting(this.db, 'cloud_folder')), last: this.last('last_cloud') },
      lastError: getSetting(this.db, 'bk:last_error') ?? null,
    };
  }
}

/** If a restore was staged, swap it in before the database is opened. Returns what was restored. */
export function applyPendingRestore(dataDir: string): Record<string, unknown> | null {
  const pending = path.join(dataDir, 'pos.db.restore-pending');
  if (!fs.existsSync(pending)) return null;
  const live = path.join(dataDir, 'pos.db');
  if (fs.existsSync(live)) fs.renameSync(live, path.join(dataDir, `pos.db.before-restore-${stamp()}`));
  for (const ext of ['-wal', '-shm']) fs.rmSync(live + ext, { force: true });
  fs.renameSync(pending, live);
  const infoFile = path.join(dataDir, 'restore-info.json');
  const info = fs.existsSync(infoFile) ? (JSON.parse(fs.readFileSync(infoFile, 'utf8')) as Record<string, unknown>) : {};
  fs.rmSync(infoFile, { force: true });
  return info;
}

export function integrityCheck(file: string): string {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    return String(db.pragma('integrity_check', { simple: true }));
  } finally {
    db.close();
  }
}

function inspect(file: string) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const integrity = String(db.pragma('integrity_check', { simple: true }));
    const count = (table: string) => (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
    const lastSale = db.prepare('SELECT max(created_at) AS t FROM sales').get() as { t: number | null };
    return { ok: integrity === 'ok', integrity, sales: count('sales'), products: count('products'), customers: count('customers'), lastSaleAt: lastSale.t };
  } catch (e) {
    return { ok: false, integrity: e instanceof Error ? e.message : String(e), sales: 0, products: 0, customers: 0, lastSaleAt: null };
  } finally {
    db.close();
  }
}

function withPlainCopy<T>(entry: BackupEntry, password: string, fn: (plainFile: string) => T): T {
  if (!entry.encrypted && !isEncryptedBackup(entry.path)) return fn(entry.path);
  const tmp = path.join(os.tmpdir(), `pos-restore-${Date.now()}.db`);
  try {
    decryptFile(entry.path, tmp, password);
    return fn(tmp);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/** Keeps the newest `keep` backup files in a folder. */
export function prune(dir: string, keep: number): void {
  if (!Number.isFinite(keep) || !fs.existsSync(dir)) return;
  const files = fs
    .readdirSync(dir)
    .filter((n) => /\.db(\.enc)?$/.test(n))
    .map((n) => ({ p: path.join(dir, n), t: fs.statSync(path.join(dir, n)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const f of files.slice(keep)) fs.rmSync(f.p, { force: true });
}

/** Removable/extra drive roots on Windows (skips C:). */
export function windowsDrives(): string[] {
  if (process.platform !== 'win32') return [];
  return 'DEFGHIJKLMNOPQRSTUVWXYZ'
    .split('')
    .map((l) => `${l}:/`)
    .filter((root) => {
      try {
        fs.accessSync(root);
        return true;
      } catch {
        return false;
      }
    });
}
