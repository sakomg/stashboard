import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  backupNow,
  checkName,
  createInvite,
  deleteInvite,
  getUser,
  listInvites,
  listUsers,
  removeUser,
  renameUser,
} from '../../storage/index.ts';
import type { Context } from '../context.ts';

export const INVITE_DAYS = 7;

export function registerUserRoutes(app: FastifyInstance, ctx: Context): void {
  const adminOnly = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!getUser(ctx.db, request.userId)?.admin) {
      return reply.code(403).send({ error: 'Only the admin can manage people' });
    }
  };

  app.patch<{ Body: { name?: unknown } }>('/api/me', async (request, reply) => {
    const name = checkName(request.body?.name);
    if (!name) {
      return reply
        .code(400)
        .send({ error: 'Use a name of up to 32 letters, digits, spaces, dots, dashes or underscores.' });
    }
    try {
      renameUser(ctx.db, request.userId, name);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
    return { name };
  });

  app.get('/api/users', { preHandler: adminOnly }, async (request) =>
    listUsers(ctx.db).map((u) => ({
      id: u.id,
      name: u.name,
      admin: u.admin,
      you: u.id === request.userId,
      accounts: u.accounts,
      createdAt: u.createdAt,
    })),
  );

  app.delete<{ Params: { id: string } }>('/api/users/:id', { preHandler: adminOnly }, async (request, reply) => {
    const id = Number(request.params.id);
    if (id === request.userId || !getUser(ctx.db, id)) return reply.code(404).send({ error: 'No such person' });
    const backup = backupNow(ctx.db, 'before-removing-a-person');
    if (!removeUser(ctx.db, id)) return reply.code(404).send({ error: 'No such person' });
    return { ok: true, backup: backup.split('/').pop() };
  });

  app.get('/api/invites', { preHandler: adminOnly }, async () => listInvites(ctx.db));

  app.post('/api/invites', { preHandler: adminOnly }, async (request, reply) => {
    if (!ctx.auth.claimed) {
      return reply.code(409).send({ error: 'Set up your own sign-in at /setup first. Friends join through it.' });
    }
    return createInvite(ctx.db, request.userId, INVITE_DAYS * 24 * 60 * 60_000);
  });

  app.delete<{ Params: { id: string } }>('/api/invites/:id', { preHandler: adminOnly }, async (request, reply) => {
    if (!deleteInvite(ctx.db, Number(request.params.id))) return reply.code(404).send({ error: 'No such invite' });
    return { ok: true };
  });
}
