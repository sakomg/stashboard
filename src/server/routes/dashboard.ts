import type { FastifyInstance } from 'fastify';
import { EXCHANGES } from '../../services/exchanges.ts';
import { historyView, portfolioView } from '../../services/view.ts';
import { fearGreed } from '../../sources/feargreed.ts';
import { zerionQuota } from '../../sources/zerion.ts';
import { getSetting, setSetting } from '../../storage/index.ts';
import type { Collection } from '../collection.ts';
import type { Context } from '../context.ts';

export function registerDashboardRoutes(
  app: FastifyInstance,
  ctx: Context,
  collection: Collection,
  build: string,
): void {
  app.get('/api/portfolio', async () => ({
    ...portfolioView(ctx.db, ctx.resolve),
    build,
    categories: ctx.categories,
    progress: collection.progress,
    zerion: zerionQuota(),
    fearGreed: await fearGreed(),
    collecting: collection.running,
    update: collection.gate(),
    demo: ctx.demo,
    heat: { weights: ctx.config.heat.weights, zones: ctx.config.heat.zones },
    exchanges: EXCHANGES,
    preferences: { hideAmounts: getSetting(ctx.db, 'hide_amounts') === '1' },
    collectEveryMinutes: collection.intervalMs / 60_000,
    loginEnabled: ctx.auth.owner !== null,
  }));

  app.get('/api/progress', async () => ({
    collecting: collection.running,
    progress: collection.progress,
    update: collection.gate(),
  }));

  app.get<{ Querystring: { days?: string } }>('/api/history', async (request) => {
    const days = Number(request.query.days);
    return historyView(ctx.db, ctx.resolve, Number.isFinite(days) && days > 0 ? days : null);
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
    setSetting(ctx.db, 'hide_amounts', hideAmounts ? '1' : '0');
    return { hideAmounts };
  });
}
