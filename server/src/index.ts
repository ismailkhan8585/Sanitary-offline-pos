import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { openDatabase } from './db';
import { seed } from './db/seed';
import { buildApp } from './app';

async function main() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const database = openDatabase(path.join(config.dataDir, 'pos.db'), config.migrationsDir);
  seed(database.db);
  const app = buildApp(database, { clientDir: config.clientDir, logger: true });
  const shutdown = async () => {
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
