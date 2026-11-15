import type { FastifyInstance } from 'fastify';
import { createShare, deleteShare, getShare, listShares, parseSharePayload } from '../../services/shares.ts';
import type { Context } from '../context.ts';

export function registerShareRoutes(app: FastifyInstance, ctx: Context): void {
  app.get('/api/shares', async () =>
    listShares(ctx.db).map((s) => ({
      token: s.token,
      title: s.payload.title,
      withAmounts: s.payload.total !== null || s.payload.rows.some((r) => r.value !== null),
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    })),
  );

  app.post('/api/shares', async (request, reply) => {
    const parsed = parseSharePayload(request.body);
    if ('error' in parsed) return reply.code(400).send({ error: parsed.error });
    const share = createShare(ctx.db, parsed.payload, parsed.days);
    return { token: share.token, expiresAt: share.expiresAt };
  });

  app.delete<{ Params: { token: string } }>('/api/shares/:token', async (request, reply) => {
    if (!deleteShare(ctx.db, request.params.token)) return reply.code(404).send({ error: 'No such link' });
    return { ok: true };
  });

  app.get<{ Params: { token: string } }>('/api/shared/:token', async (request, reply) => {
    const share = getShare(ctx.db, request.params.token);
    reply.header('Cache-Control', 'no-store');
    if (!share) return reply.code(404).send({ error: 'This link has expired or was turned off.' });
    return { ...share.payload, expiresAt: share.expiresAt };
  });
}
