import type { FastifyInstance } from 'fastify';
import { setManualCategory } from '../../services/categories.ts';
import { addExchange, checkBinanceKey, EXCHANGES, type ExchangeKind } from '../../services/exchanges.ts';
import { addWallet, removeAccount, renameAccount } from '../../storage/index.ts';
import type { Collection } from '../collection.ts';
import type { Context } from '../context.ts';

const API_KEY = /^[A-Za-z0-9]{16,128}$/;

export function registerAccountRoutes(app: FastifyInstance, ctx: Context, collection: Collection): void {
  app.post<{ Body: { address?: unknown; label?: unknown } }>('/api/wallets', async (request, reply) => {
    const { address, label } = request.body ?? {};
    if (typeof address !== 'string' || address.trim() === '')
      return reply.code(400).send({ error: 'Enter a wallet address' });
    try {
      const wallet = addWallet(
        ctx.db,
        request.userId,
        address,
        typeof label === 'string' ? label.slice(0, 40) : undefined,
      );
      collection.collectAfterCurrent();
      return { id: wallet.id, kind: wallet.kind, label: wallet.label };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post<{ Body: { exchange?: unknown; apiKey?: unknown; apiSecret?: unknown; label?: unknown } }>(
    '/api/exchanges',
    async (request, reply) => {
      const { exchange, apiKey, apiSecret, label } = request.body ?? {};
      if (typeof exchange !== 'string' || !(exchange in EXCHANGES)) {
        return reply.code(400).send({ error: 'Choose an exchange' });
      }
      const key = typeof apiKey === 'string' ? apiKey.trim() : '';
      const secret = typeof apiSecret === 'string' ? apiSecret.trim() : '';
      if (!API_KEY.test(key) || !API_KEY.test(secret)) {
        return reply
          .code(400)
          .send({ error: 'Paste the API key and the secret key exactly as the exchange shows them' });
      }
      const keys = { apiKey: key, apiSecret: secret };
      try {
        const { extra, ipRestricted } = await checkBinanceKey(keys);
        if (extra.length > 0) {
          return reply.code(400).send({
            error: `This key can do more than read: ${extra.join(', ')}. Create a key with only Enable Reading ticked.`,
          });
        }
        const account = addExchange(
          ctx.db,
          request.userId,
          exchange as ExchangeKind,
          keys,
          typeof label === 'string' ? label.slice(0, 40) : undefined,
        );
        collection.collectAfterCurrent();
        return {
          id: account.id,
          label: account.label,
          warning: ipRestricted
            ? null
            : "The key is not restricted to trusted IP addresses. Restricting it to this server's address is safer.",
        };
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  app.patch<{ Params: { id: string }; Body: { label?: unknown } }>('/api/accounts/:id', async (request, reply) => {
    const label = typeof request.body?.label === 'string' ? request.body.label.trim().slice(0, 40) : '';
    if (!label) return reply.code(400).send({ error: 'Enter a name for the account' });
    if (!renameAccount(ctx.db, request.userId, Number(request.params.id), label)) {
      return reply.code(404).send({ error: 'No such account' });
    }
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/accounts/:id', async (request, reply) => {
    if (!removeAccount(ctx.db, request.userId, Number(request.params.id)))
      return reply.code(404).send({ error: 'No such account' });
    return { ok: true };
  });

  app.put<{ Params: { key: string }; Body: { category?: unknown } }>(
    '/api/assets/:key/category',
    async (request, reply) => {
      const { key } = request.params;
      const { category } = request.body ?? {};
      if (!key || key.length > 40) return reply.code(400).send({ error: 'No such asset' });
      if (category !== null && !(typeof category === 'string' && ctx.categories.includes(category))) {
        return reply.code(400).send({ error: 'Choose one of the listed categories' });
      }
      setManualCategory(ctx.db, request.userId, key, category);
      return { ok: true };
    },
  );
}
