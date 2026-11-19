import { AppError } from './errors';

/** Counts failed attempts per key; blocks the key for `windowMs` after `max` failures. */
export function createLimiter(max: number, windowMs: number) {
  const fails = new Map<string, { count: number; until: number }>();
  return {
    check(key: string, now = Date.now()) {
      const f = fails.get(key);
      if (f && f.count >= max && f.until > now) {
        throw new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many wrong PINs. Wait one minute and try again.');
      }
    },
    fail(key: string, now = Date.now()) {
      const f = fails.get(key);
      const count = f && f.until > now ? f.count + 1 : 1;
      fails.set(key, { count, until: now + windowMs });
    },
    reset(key: string) {
      fails.delete(key);
    },
  };
}
