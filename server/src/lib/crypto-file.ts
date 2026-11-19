import crypto from 'node:crypto';
import fs from 'node:fs';
import { AppError } from './errors';

/** File layout: MAGIC | salt(16) | iv(12) | ciphertext | tag(16). Key = scrypt(password, salt). */
const MAGIC = Buffer.from('HPOSBAK1');

function keyFor(password: string, salt: Buffer): Buffer {
  return crypto.scryptSync(password, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

/** Encrypts a backup with AES-256-GCM so it is safe to carry outside the shop. */
export function encryptFile(src: string, dest: string, password: string): void {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyFor(password, salt), iv);
  const body = Buffer.concat([cipher.update(fs.readFileSync(src)), cipher.final()]);
  const tmp = `${dest}.tmp`;
  fs.writeFileSync(tmp, Buffer.concat([MAGIC, salt, iv, body, cipher.getAuthTag()]));
  fs.renameSync(tmp, dest);
}

export function isEncryptedBackup(file: string): boolean {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(MAGIC.length);
    fs.readSync(fd, head, 0, MAGIC.length, 0);
    return head.equals(MAGIC);
  } finally {
    fs.closeSync(fd);
  }
}

export function decryptFile(src: string, dest: string, password: string): void {
  const data = fs.readFileSync(src);
  if (!data.subarray(0, MAGIC.length).equals(MAGIC)) throw new AppError(400, 'BACKUP_NOT_ENCRYPTED', 'This file is not an encrypted backup.');
  const salt = data.subarray(8, 24);
  const iv = data.subarray(24, 36);
  const tag = data.subarray(data.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyFor(password, salt), iv);
  decipher.setAuthTag(tag);
  try {
    fs.writeFileSync(dest, Buffer.concat([decipher.update(data.subarray(36, data.length - 16)), decipher.final()]));
  } catch {
    throw new AppError(400, 'WRONG_BACKUP_PASSWORD', 'Wrong backup password, or the file is damaged.');
  }
}
