import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import type { DB } from '../db';
import { getSetting } from './settings';

/** Public half of the vendor key pair (scripts/licence.ts keys). Only the vendor can make licences. */
export const LICENCE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAF4NN2rdc8cT/wpSbPT3wI7b217qr/KVDIrzcsTEJOUU=
-----END PUBLIC KEY-----`;

export const TRIAL_DAYS = 30;
const DAY = 86_400_000;

/** Stable ID of this PC: Windows MachineGuid (fallback: host name + network cards), shown as XXXX-XXXX-XXXX-XXXX. */
export function hardwareId(): string {
  let raw = '';
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true });
      raw = /MachineGuid\s+REG_SZ\s+(\S+)/.exec(out)?.[1] ?? '';
    }
  } catch {
    raw = '';
  }
  if (!raw) {
    const macs = Object.values(os.networkInterfaces())
      .flat()
      .filter((n) => n && !n.internal && n.mac !== '00:00:00:00:00:00')
      .map((n) => n!.mac)
      .sort();
    raw = `${os.hostname()}|${macs.join(',')}`;
  }
  const hex = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16).toUpperCase();
  return hex.match(/.{4}/g)!.join('-');
}

interface Payload {
  h: string;
  /** Expiry time (ms); 0 = never. */
  e: number;
}

export function makeLicenceKey(privateKeyPem: string, hwid: string, expires: number): string {
  const body = Buffer.from(JSON.stringify({ h: hwid, e: expires } satisfies Payload)).toString('base64url');
  const sig = crypto.sign(null, Buffer.from(body), privateKeyPem).toString('base64url');
  return `${body}.${sig}`;
}

export function readLicenceKey(key: string, hwid: string, publicKeyPem = LICENCE_PUBLIC_KEY): { valid: boolean; expiresAt: number | null; reason?: string } {
  const [body, sig] = key.trim().split('.');
  if (!body || !sig) return { valid: false, expiresAt: null, reason: 'format' };
  let ok = false;
  try {
    ok = crypto.verify(null, Buffer.from(body), publicKeyPem, Buffer.from(sig, 'base64url'));
  } catch {
    ok = false;
  }
  if (!ok) return { valid: false, expiresAt: null, reason: 'signature' };
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as Payload;
  if (payload.h !== hwid) return { valid: false, expiresAt: null, reason: 'other-pc' };
  return { valid: true, expiresAt: payload.e || null };
}

export const seenKey = (hwid: string) => `hw_seen:${hwid}`;

export interface LicenceStatus {
  hardwareId: string;
  status: 'active' | 'trial' | 'expired';
  /** Days left of the trial or of a time-limited licence; null when it never ends. */
  daysLeft: number | null;
}

export function licenceStatus(db: DB, hwid: string, now = Date.now(), publicKeyPem = LICENCE_PUBLIC_KEY): LicenceStatus {
  const key = getSetting(db, 'licence_key');
  if (key) {
    const lic = readLicenceKey(key, hwid, publicKeyPem);
    if (lic.valid && (lic.expiresAt === null || lic.expiresAt > now)) {
      return { hardwareId: hwid, status: 'active', daysLeft: lic.expiresAt ? Math.ceil((lic.expiresAt - now) / DAY) : null };
    }
  }
  // The trial runs from the first day THIS PC ran THIS database, so a replacement PC after a
  // disaster restore keeps selling for 30 days while its new licence key is arranged.
  const since = Number(getSetting(db, seenKey(hwid)) ?? getSetting(db, 'installed_at') ?? now);
  const left = Math.ceil((since + TRIAL_DAYS * DAY - now) / DAY);
  return { hardwareId: hwid, status: left > 0 ? 'trial' : 'expired', daysLeft: Math.max(0, left) };
}
