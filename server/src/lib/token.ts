import crypto from 'node:crypto';

export interface TokenPayload {
  uid: number;
  did: number | null;
  exp: number;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');
const sig = (data: string, secret: string) => crypto.createHmac('sha256', secret).update(data).digest('base64url');

export function signToken(payload: TokenPayload, secret: string): string {
  const data = b64(JSON.stringify(payload));
  return `${data}.${sig(data, secret)}`;
}

export function verifyToken(token: string, secret: string, now = Date.now()): TokenPayload | null {
  const [data, mac] = token.split('.');
  if (!data || !mac) return null;
  const expected = sig(data, secret);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as TokenPayload;
    return payload.exp > now ? payload : null;
  } catch {
    return null;
  }
}
