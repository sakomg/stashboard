import type { FastifyInstance } from 'fastify';
import { errorText } from '../../lib/errors.ts';
import { welcome } from '../../services/notify.ts';
import { pushTargetProblem, type PushTarget } from '../../sources/webpush.ts';
import { removeSubscription } from '../../storage/index.ts';
import type { Collection } from '../collection.ts';
import type { Context } from '../context.ts';

export function registerPushRoutes(app: FastifyInstance, ctx: Context, collection: Collection): void {
  app.post<{ Body: { endpoint?: unknown; keys?: unknown } }>('/api/push', async (request, reply) => {
    const { endpoint, keys } = request.body ?? {};
    const { p256dh, auth } = typeof keys === 'object' && keys !== null ? (keys as Record<string, unknown>) : {};
    const problem = pushTargetProblem({ endpoint, p256dh, auth });
    if (problem) return reply.code(400).send({ error: problem });
    try {
      await welcome(ctx.db, request.userId, { endpoint, p256dh, auth } as PushTarget, collection.notifyOptions());
    } catch (err) {
      return reply.code(502).send({ error: errorText(err) });
    }
    return { ok: true };
  });

  app.delete<{ Body: { endpoint?: unknown } }>('/api/push', async (request, reply) => {
    const { endpoint } = request.body ?? {};
    if (typeof endpoint !== 'string' || !removeSubscription(ctx.db, request.userId, endpoint)) {
      return reply.code(404).send({ error: 'This device does not get notifications' });
    }
    return { ok: true };
  });
}
