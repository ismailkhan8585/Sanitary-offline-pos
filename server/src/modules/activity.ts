import type { FastifyInstance } from 'fastify';
import { and, desc, eq, gte, like, lte } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { z } from 'zod';
import { activityLog, approvals, devices, users } from '../db/schema';
import { requirePerm } from '../lib/auth';

const listQuery = z.object({
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  userId: z.coerce.number().int().optional(),
  action: z.string().trim().max(40).optional(),
});

export function activityRoutes(app: FastifyInstance): void {
  const { db } = app.ctx;
  const guard = { preHandler: requirePerm('activity.view') };

  app.get('/api/activity', guard, async (req) => {
    const q = listQuery.parse(req.query);
    return db
      .select({
        id: activityLog.id,
        action: activityLog.action,
        details: activityLog.details,
        createdAt: activityLog.createdAt,
        userName: users.name,
        deviceName: devices.name,
      })
      .from(activityLog)
      .leftJoin(users, eq(users.id, activityLog.userId))
      .leftJoin(devices, eq(devices.id, activityLog.deviceId))
      .where(
        and(
          q.from ? gte(activityLog.createdAt, q.from) : undefined,
          q.to ? lte(activityLog.createdAt, q.to) : undefined,
          q.userId ? eq(activityLog.userId, q.userId) : undefined,
          q.action ? like(activityLog.action, `${q.action}%`) : undefined,
        ),
      )
      .orderBy(desc(activityLog.id))
      .limit(1000)
      .all();
  });

  app.get('/api/approvals', guard, async (req) => {
    const q = listQuery.parse(req.query);
    const approver = alias(users, 'approver');
    return db
      .select({
        id: approvals.id,
        action: approvals.action,
        details: approvals.details,
        createdAt: approvals.createdAt,
        requestedBy: users.name,
        approvedBy: approver.name,
      })
      .from(approvals)
      .leftJoin(users, eq(users.id, approvals.requestedBy))
      .leftJoin(approver, eq(approver.id, approvals.approvedBy))
      .where(and(q.from ? gte(approvals.createdAt, q.from) : undefined, q.to ? lte(approvals.createdAt, q.to) : undefined))
      .orderBy(desc(approvals.id))
      .limit(1000)
      .all();
  });
}
