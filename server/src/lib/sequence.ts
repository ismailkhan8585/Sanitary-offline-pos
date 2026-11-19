import type { DB } from '../db';
import { getSetting, setSetting } from './settings';

/** Next number of a named counter (e.g. bills of counter A). Call inside a transaction. */
export function nextNumber(db: DB, name: string): number {
  const key = `seq:${name}`;
  const next = Number(getSetting(db, key) ?? '0') + 1;
  setSetting(db, key, String(next));
  return next;
}

export const pad5 = (n: number) => String(n).padStart(5, '0');
