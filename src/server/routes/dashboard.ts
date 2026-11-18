import type { FastifyInstance } from 'fastify';
import { boardHistory, boardPortfolio, boardView } from '../../services/board.ts';
import { CLIENTS, EXCHANGE_KINDS } from '../../services/exchanges.ts';
import { vapidKeys } from '../../services/notify.ts';
import { historyView, portfolioView } from '../../services/view.ts';
import { fearGreed } from '../../sources/feargreed.ts';
import { zerionQuota } from '../../sources/zerion.ts';
import { getUser, listAccounts, markHeatSeen, setHideAmounts, setOnBoard } from '../../storage/index.ts';
import { progressFor, type Collection } from '../collection.ts';
import type { Context } from '../context.ts';

export function registerDashboardRoutes(
  app: FastifyInstance,
  ctx: Context,
  collection: Collection,
  build: string,
): void {
  const ownAccounts = (userId: number): Set<number> => new Set(listAccounts(ctx.db, userId).map((a) => a.id));
  const progressOf = (userId: number) => {
    const own = ownAccounts(userId);
    return collection.collecting(own) ? progressFor(collection.progress, own) : null;
  };

  const page = async (userId: number) => {
    const me = getUser(ctx.db, userId);
    return {
      build,
      categories: ctx.categories,
      fearGreed: await fearGreed(),
      demo: ctx.demo,
      heat: { weights: ctx.config.heat.weights, zones: ctx.config.heat.zones },
      preferences: { hideAmounts: me?.hideAmounts ?? false },
      collectEveryMinutes: collection.everyMinutes,
      loginEnabled: ctx.auth.claimed,
      me: me && { name: me.name, admin: me.admin },
      pushKey: vapidKeys(ctx.db).publicKey,
    };
  };
  const daysOf = (query: { days?: string }): number | null => {
    const days = Number(query.days);
    return Number.isFinite(days) && days > 0 ? days : null;
  };
  const NOT_ON_BOARD = 'This portfolio is not on the board';

  app.get('/api/portfolio', async (request) => ({
    ...portfolioView(ctx.db, request.userId, ctx.resolveFor(request.userId)),
    ...(await page(request.userId)),
    progress: progressOf(request.userId),
    zerion: zerionQuota(),
    collecting: collection.collecting(ownAccounts(request.userId)),
    update: collection.gate(),
    serverAddress: await ctx.address(),
    ipRequired: Object.fromEntries(EXCHANGE_KINDS.map((kind) => [kind, CLIENTS[kind].ipRequired])),
  }));

  app.get<{ Params: { key: string } }>('/api/board/:key/portfolio', async (request, reply) => {
    const view = boardPortfolio(ctx.db, request.userId, request.params.key, ctx.resolveFor);
    if (!view) return reply.code(404).send({ error: NOT_ON_BOARD });
    return {
      ...view,
      ...(await page(request.userId)),
      progress: null,
      zerion: null,
      collecting: false,
      update: { allowed: false, reason: 'Someone else’s portfolio', availableAt: null },
      serverAddress: null,
      ipRequired: {},
    };
  });

  app.get<{ Params: { key: string }; Querystring: { days?: string } }>(
    '/api/board/:key/history',
    async (request, reply) =>
      boardHistory(ctx.db, request.userId, request.params.key, ctx.resolveFor, daysOf(request.query)) ??
      reply.code(404).send({ error: NOT_ON_BOARD }),
  );

  app.get('/api/progress', async (request) => ({
    collecting: collection.collecting(ownAccounts(request.userId)),
    progress: progressOf(request.userId),
    update: collection.gate(),
  }));

  app.get<{ Querystring: { days?: string } }>('/api/history', async (request) =>
    historyView(ctx.db, request.userId, ctx.resolveFor(request.userId), daysOf(request.query)),
  );

  app.post('/api/collect', async (request, reply) => {
    const gate = collection.gate();
    if (!gate.allowed) return reply.code(429).send({ error: gate.reason, update: gate });
    void collection.collect();
    await collection.settled(ownAccounts(request.userId));
    return { ok: true };
  });

  app.get('/api/board', async (request) => boardView(ctx.db, request.userId, ctx.resolveFor));

  app.put<{ Body: { hideAmounts?: unknown; onBoard?: unknown } }>('/api/preferences', async (request, reply) => {
    const { hideAmounts, onBoard } = request.body ?? {};
    const flag = (v: unknown): boolean => v === undefined || typeof v === 'boolean';
    if (!flag(hideAmounts) || !flag(onBoard) || (hideAmounts === undefined && onBoard === undefined)) {
      return reply.code(400).send({ error: 'hideAmounts and onBoard must be true or false' });
    }
    if (typeof hideAmounts === 'boolean') setHideAmounts(ctx.db, request.userId, hideAmounts);
    if (typeof onBoard === 'boolean') setOnBoard(ctx.db, request.userId, onBoard);
    const me = getUser(ctx.db, request.userId);
    return { hideAmounts: me?.hideAmounts ?? false, onBoard: me?.onBoard ?? false };
  });

  app.post<{ Body: { assets?: unknown } }>('/api/heat/dismiss', async (request, reply) => {
    const { assets } = request.body ?? {};
    const valid =
      Array.isArray(assets) &&
      assets.length > 0 &&
      assets.length <= 200 &&
      assets.every((a) => typeof a === 'string' && a.length > 0 && a.length <= 64);
    if (!valid) return reply.code(400).send({ error: 'assets must be a list of asset names' });
    return { dismissed: markHeatSeen(ctx.db, request.userId, assets as string[]) };
  });
}
