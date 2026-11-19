import type BetterSqlite3 from 'better-sqlite3';

/**
 * Runs `fn` in one SQLite transaction (nested calls become savepoints).
 * Any throw rolls back every write made inside.
 */
export function transaction<T>(sqlite: BetterSqlite3.Database, fn: () => T): T {
  return sqlite.transaction(fn)();
}
