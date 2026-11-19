import fs from 'node:fs';
import path from 'node:path';

const serverRoot = path.resolve(__dirname, '..');

export const config = {
  port: Number(process.env.POS_PORT ?? 3000),
  host: process.env.POS_HOST ?? '0.0.0.0',
  dataDir: process.env.POS_DATA_DIR ?? path.join(serverRoot, 'data'),
  clientDir: process.env.POS_CLIENT_DIR ?? path.resolve(serverRoot, '../client/dist'),
  migrationsDir: process.env.POS_MIGRATIONS_DIR ?? path.join(serverRoot, 'migrations'),
  /** Second drive when present (rule 3-2-1); can be changed on the Backup page. */
  backupDir: process.env.POS_BACKUP_DIR ?? (process.platform === 'win32' && fs.existsSync('D:/') ? 'D:/POS-Backups' : path.join(serverRoot, 'backups')),
};
