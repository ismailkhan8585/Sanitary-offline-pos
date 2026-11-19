import type { DB } from '../db';
import { activityLog } from '../db/schema';

export interface Actor {
  userId: number | null;
  deviceId: number | null;
}

export function logActivity(db: DB, actor: Actor, action: string, details: unknown = ''): void {
  db.insert(activityLog)
    .values({
      userId: actor.userId,
      deviceId: actor.deviceId,
      action,
      details: typeof details === 'string' ? details : JSON.stringify(details),
    })
    .run();
}
