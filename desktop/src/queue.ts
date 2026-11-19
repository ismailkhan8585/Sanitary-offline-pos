import fs from 'node:fs';
import initSqlJs, { type Database } from 'sql.js';
import type { Catalog, EmergencyBill } from './types';

/**
 * Local SQLite (sql.js, no native module) holding the product catalogue and bills made
 * while the server is down. The file is rewritten atomically after every change.
 */
export class EmergencyQueue {
  private constructor(
    private db: Database,
    private file: string,
  ) {}

  static async open(file: string, wasmPath?: string): Promise<EmergencyQueue> {
    const SQL = await initSqlJs(wasmPath ? { locateFile: () => wasmPath } : undefined);
    const db = fs.existsSync(file) ? new SQL.Database(fs.readFileSync(file)) : new SQL.Database();
    db.run(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS bills (bill_no TEXT PRIMARY KEY, created_at INTEGER NOT NULL, data TEXT NOT NULL, uploaded_at INTEGER);`);
    const q = new EmergencyQueue(db, file);
    q.persist();
    return q;
  }

  private persist(): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, Buffer.from(this.db.export()));
    fs.renameSync(tmp, this.file);
  }

  private get(key: string): string | undefined {
    const res = this.db.exec('SELECT value FROM kv WHERE key = ?', [key]);
    return res[0]?.values[0]?.[0] as string | undefined;
  }

  private set(key: string, value: string): void {
    this.db.run('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
  }

  saveCatalog(catalog: Catalog): void {
    this.set('catalog', JSON.stringify(catalog));
    const seqKey = `seq:${catalog.device.billPrefix}`;
    // Never reuse a number the server already has (e.g. after reinstalling this counter).
    if (Number(this.get(seqKey) ?? 0) < catalog.lastEmergencyNo) this.set(seqKey, String(catalog.lastEmergencyNo));
    this.persist();
  }

  catalog(): Catalog | null {
    const raw = this.get('catalog');
    return raw ? (JSON.parse(raw) as Catalog) : null;
  }

  /** Saves a bill under the next E-<letter>-00001 number and returns it. */
  addBill(bill: Omit<EmergencyBill, 'billNo'>, prefix: string): EmergencyBill {
    const seqKey = `seq:${prefix}`;
    const next = Number(this.get(seqKey) ?? 0) + 1;
    const saved: EmergencyBill = { ...bill, billNo: `E-${prefix}-${String(next).padStart(5, '0')}` };
    this.db.run('BEGIN');
    try {
      this.set(seqKey, String(next));
      this.db.run('INSERT INTO bills (bill_no, created_at, data) VALUES (?, ?, ?)', [saved.billNo, saved.createdAt, JSON.stringify(saved)]);
      this.db.run('COMMIT');
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    }
    this.persist();
    return saved;
  }

  pending(): EmergencyBill[] {
    const res = this.db.exec('SELECT data FROM bills WHERE uploaded_at IS NULL ORDER BY created_at');
    return (res[0]?.values ?? []).map((r) => JSON.parse(String(r[0])) as EmergencyBill);
  }

  markUploaded(billNos: string[], at = Date.now()): void {
    for (const no of billNos) this.db.run('UPDATE bills SET uploaded_at = ? WHERE bill_no = ?', [at, no]);
    this.persist();
  }
}
