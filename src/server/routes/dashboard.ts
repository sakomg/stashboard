import type { FastifyInstance } from 'fastify';
import { EXCHANGES } from '../../services/exchanges.ts';
import { historyView, portfolioView } from '../../services/view.ts';
import { fearGreed } from '../../sources/feargreed.ts';
import { zerionQuota } from '../../sources/zerion.ts';
import { getUser, listAccounts, setHideAmounts } from '../../storage/index.ts';
import type { Collection } from '../collection.ts';
import type { Context } from '../context.ts';

export function registerDashboardRoutes(
  app: FastifyInstance,
  ctx: Context,
  collection: Collection,
  build: string,
): void {
  const progressOf = (userId: number): Collection['progress'] => {
    const { progress } = collection;
    if (!progress) return null;
    const own = new Set(listAccounts(ctx.db, userId).map((a) => a.id));
    return { ...progress, accounts: progress.accounts.filter((a) => own.has(a.id)) };
  };

  app.get('/api/portfolio', async (request) => {
    const me = getUser(ctx.db, request.userId);
    return {
      ...portfolioView(ctx.db, request.userId, ctx.resolveFor(request.userId)),
      build,
      categories: ctx.categories,
      progress: progressOf(request.userId),
      zerion: zerionQuota(),
      fearGreed: await fearGreed(),
      collecting: collection.running,
      update: collection.gate(),
      demo: ctx.demo,
      heat: { weights: ctx.config.heat.weights, zones: ctx.config.heat.zones },
      exchanges: EXCHANGES,
      preferences: { hideAmounts: me?.hideAmounts ?? false },
      collectEveryMinutes: collection.intervalMs / 60_000,
      loginEnabled: ctx.auth.claimed,
      me: me && { name: me.name, admin: me.admin },
    };
  });

  app.get('/api/progress', async (request) => ({
    collecting: collection.running,
    progress: progressOf(request.userId),
    update: collection.gate(),
  }));

  app.get<{ Querystring: { days?: string } }>('/api/history', async (request) => {
    const days = Number(request.query.days);
    return historyView(
      ctx.db,
      request.userId,
      ctx.resolveFor(request.userId),
      Number.isFinite(days) && days > 0 ? days : null,
    );
  });

  app.post('/api/collect', async (_request, reply) => {
    const gate = collection.gate();
    if (!gate.allowed && !collection.running) return reply.code(429).send({ error: gate.reason, update: gate });
    await collection.collect();
    return { ok: true };
  });

  app.put<{ Body: { hideAmounts?: unknown } }>('/api/preferences', async (request, reply) => {
    const { hideAmounts } = request.body ?? {};
    if (typeof hideAmounts !== 'boolean') return reply.code(400).send({ error: 'hideAmounts must be true or false' });
    setHideAmounts(ctx.db, request.userId, hideAmounts);
    return { hideAmounts };
  });
}
