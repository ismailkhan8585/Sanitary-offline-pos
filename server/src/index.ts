import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { openDatabase } from './db';
import { seed } from './db/seed';
import { buildApp } from './app';
import { hardwareId } from './lib/licence';
import { logActivity } from './lib/activity';
import { startScheduler } from './lib/scheduler';
import { applyPendingRestore, BackupService } from './modules/backup/service';

async function main() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  // A restore chosen on the Restore screen is swapped in here, before the database opens.
  const restored = applyPendingRestore(config.dataDir);
  const dbFile = path.join(config.dataDir, 'pos.db');
  const database = openDatabase(dbFile, config.migrationsDir);
  seed(database.db);
  if (restored) logActivity(database.db, { userId: null, deviceId: null }, 'backup.restored', restored);

  const backup = new BackupService(database.sqlite, database.db, { dataDir: config.dataDir, dbFile, defaultBackupDir: config.backupDir });
  const app = buildApp(database, {
    clientDir: config.clientDir,
    logger: true,
    hardwareId: hardwareId(),
    backup,
    // The Windows service restarts the server, which then applies the staged restore.
    onRestoreStaged: () => setTimeout(() => shutdown(), 1000),
  });
  const stopScheduler = startScheduler(database.sqlite, database.db, backup, app.log);

  const shutdown = async () => {
    stopScheduler();
    backup.stopReplica();
    await app.close();
    database.sqlite.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
