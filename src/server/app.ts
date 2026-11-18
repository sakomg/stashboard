import Fastify, { type FastifyInstance } from 'fastify';
import { registerAccess } from './access.ts';
import { createCollection, type Collection } from './collection.ts';
import type { Context } from './context.ts';
import { registerAccountRoutes } from './routes/accounts.ts';
import { registerAuthRoutes } from './routes/auth.ts';
import { registerDashboardRoutes } from './routes/dashboard.ts';
import { registerPushRoutes } from './routes/push.ts';
import { registerShareRoutes } from './routes/shares.ts';
import { registerUserRoutes } from './routes/users.ts';
import { buildStamp, registerStatic, staticFiles } from './static.ts';

export function createApp(ctx: Context): { app: FastifyInstance; collection: Collection } {
  const app = Fastify({ logger: { level: 'warn' }, trustProxy: process.env.TRUST_PROXY === '1' });
  const files = staticFiles(ctx.root);
  const collection = createCollection(ctx, app.log);

  registerAccess(app, ctx, files);
  registerStatic(app, ctx, files);
  registerAuthRoutes(app, ctx);
  registerDashboardRoutes(app, ctx, collection, buildStamp(ctx.root));
  registerAccountRoutes(app, ctx, collection);
  registerShareRoutes(app, ctx);
  registerPushRoutes(app, ctx, collection);
  registerUserRoutes(app, ctx);
  return { app, collection };
}
