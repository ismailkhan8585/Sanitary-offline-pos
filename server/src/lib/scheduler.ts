import type { FastifyBaseLogger } from 'fastify';
import type { DB } from '../db';
import type Database from 'better-sqlite3';
import { getSetting, setSetting } from './settings';
import type { BackupService } from '../modules/backup/service';
import { saveExports } from '../modules/closing';

const HOUR = 3_600_000;
const REPLICA_EVERY = 5 * 60_000;

const todayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/**
 * Background jobs, checked every minute:
 *  - hourly backup;
 *  - at closing time (once a day): daily backup, USB disk copy, cloud copy, closing PDF / monthly Excel, PRAGMA optimize;
 *  - live replica every 5 minutes.
 */
export function startScheduler(sqlite: Database.Database, db: DB, backup: BackupService, log: FastifyBaseLogger): () => void {
  let lastReplica = 0;
  const safe = (name: string, fn: () => unknown) => {
    try {
      const r = fn();
      if (r instanceof Promise) r.catch((e) => log.error({ err: e }, `${name} failed`));
    } catch (e) {
      log.error({ err: e }, `${name} failed`);
    }
  };

  const tick = () => {
    const now = new Date();
    const lastHourly = Number(getSetting(db, 'bk:last_hourly') ?? 0);
    if (now.getTime() - lastHourly >= HOUR) safe('hourly backup', () => backup.run('hourly'));

    const [h, m] = (getSetting(db, 'closing_time') ?? '22:00').split(':').map(Number);
    const closing = new Date(now);
    closing.setHours(h, m, 0, 0);
    if (now >= closing && getSetting(db, 'bk:daily_done') !== todayKey(now)) {
      setSetting(db, 'bk:daily_done', todayKey(now));
      safe('daily backup', () => backup.run('daily'));
      safe('usb disk copy', () => getSetting(db, 'backup_password') && backup.copyToUsbDisk());
      safe('cloud copy', () => getSetting(db, 'backup_password') && backup.copyToCloud());
      safe('closing exports', () => saveExports(db, backup.dir(), now));
      safe('optimize', () => sqlite.pragma('optimize'));
    }

    if (now.getTime() - lastReplica >= REPLICA_EVERY) {
      lastReplica = now.getTime();
      safe('replica', () => backup.replicaTick());
    }
  };

  tick();
  const timer = setInterval(tick, 60_000);
  return () => clearInterval(timer);
}
