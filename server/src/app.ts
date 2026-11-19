import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import type { Database } from './db';
import { AppError } from './lib/errors';
import { registerAuth } from './lib/auth';
import { getSetting } from './lib/settings';
import { authRoutes } from './modules/auth';
import { userRoutes } from './modules/users';
import { deviceRoutes } from './modules/devices';
import { settingsRoutes } from './modules/settings';
import { productRoutes } from './modules/products/routes';
import { productExcelRoutes } from './modules/products/excel';
import { stockRoutes } from './modules/stock';
import { customerRoutes } from './modules/customers';
import { plumberRoutes } from './modules/plumbers';
import { salesRoutes } from './modules/sales/routes';
import { supplierRoutes } from './modules/suppliers';
import { paymentRoutes } from './modules/payments';
import { purchaseRoutes } from './modules/purchases';
import { returnRoutes } from './modules/returns';
import { challanRoutes } from './modules/challans';
import fastifyMultipart from '@fastify/multipart';

export interface AppOptions {
  clientDir?: string;
  logger?: boolean;
}

export function buildApp(database: Database, opts: AppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 20 * 1024 * 1024 });
  app.decorate('ctx', database);
  app.register(fastifyMultipart, { limits: { fileSize: 200 * 1024 * 1024, files: 1 } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.status(400).send({
        code: 'VALIDATION',
        message: `Please check ${first?.path.join('.') || 'the form'}: ${first?.message}`,
        issues: err.issues,
      });
    }
    if (err instanceof AppError) return reply.status(err.status).send({ code: err.code, message: err.message, params: err.params });
    if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ code: 'BAD_REQUEST', message: err.message });
    req.log.error(err);
    return reply.status(500).send({ code: 'SERVER_ERROR', message: 'Something went wrong on the server. Try again.' });
  });

  const secret = getSetting(database.db, 'auth_secret');
  if (!secret) throw new Error('auth_secret missing: run seed() before buildApp()');
  registerAuth(app, secret);
  app.get('/api/health', { config: { public: true } }, async () => ({ ok: true, time: Date.now() }));
  authRoutes(app, secret);
  userRoutes(app);
  deviceRoutes(app);
  settingsRoutes(app);
  productRoutes(app);
  productExcelRoutes(app);
  stockRoutes(app);
  customerRoutes(app);
  plumberRoutes(app);
  salesRoutes(app);
  supplierRoutes(app);
  paymentRoutes(app);
  purchaseRoutes(app);
  returnRoutes(app);
  challanRoutes(app);

  if (opts.clientDir && fs.existsSync(path.join(opts.clientDir, 'index.html'))) {
    app.register(fastifyStatic, { root: opts.clientDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.status(404).send({ code: 'NOT_FOUND', message: 'Not found.' });
      return reply.sendFile('index.html');
    });
  }
  return app;
}
