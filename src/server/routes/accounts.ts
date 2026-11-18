import type { FastifyInstance } from 'fastify';
import { errorText } from '../../lib/errors.ts';
import { setManualCategory } from '../../services/categories.ts';
import {
  addExchange,
  bindingAdvice,
  CLIENTS,
  isExchange,
  replaceExchangeKeys,
  type ExchangeKeys,
  type ExchangeKind,
} from '../../services/exchanges.ts';
import { addWallet, listAccounts, removeAccount, renameAccount } from '../../storage/index.ts';
import type { Collection } from '../collection.ts';
import type { Context } from '../context.ts';

const API_KEY = /^[A-Za-z0-9-]{16,128}$/;
const PASSPHRASE = /^[\x20-\x7e]{1,64}$/;

interface KeyBody {
  apiKey?: unknown;
  apiSecret?: unknown;
  passphrase?: unknown;
}

type Checked = { keys: ExchangeKeys; ipRestricted: boolean } | { error: string };

async function checkedKeys(kind: ExchangeKind, body: KeyBody): Promise<Checked> {
  const client = CLIENTS[kind];
  const key = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const secret = typeof body.apiSecret === 'string' ? body.apiSecret.trim() : '';
  if (!API_KEY.test(key) || !API_KEY.test(secret)) {
    return { error: 'Paste the API key and the secret key exactly as the exchange shows them' };
  }
  const keys: ExchangeKeys = { apiKey: key, apiSecret: secret };
  if (client.passphrase) {
    if (typeof body.passphrase !== 'string' || !PASSPHRASE.test(body.passphrase)) {
      return { error: 'Enter the passphrase you set when you created the key' };
    }
    keys.passphrase = body.passphrase;
  }
  try {
    const { extra, ipRestricted, host } = await client.check(keys);
    if (extra.length > 0) return { error: `This key can do more than read: ${extra.join(', ')}. ${client.readOnly}` };
    return { keys: host ? { ...keys, host } : keys, ipRestricted };
  } catch (err) {
    return { error: errorText(err) };
  }
}

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
      void collection.readAccount(wallet.id);
      return { id: wallet.id, kind: wallet.kind, label: wallet.label };
    } catch (err) {
      return reply.code(400).send({ error: errorText(err) });
    }
  });

  app.post<{ Body: KeyBody & { exchange?: unknown; label?: unknown } }>('/api/exchanges', async (request, reply) => {
    const { exchange, label } = request.body ?? {};
    if (typeof exchange !== 'string' || !isExchange(exchange)) {
      return reply.code(400).send({ error: 'Choose an exchange' });
    }
    const checked = await checkedKeys(exchange, request.body ?? {});
    if ('error' in checked) return reply.code(400).send({ error: checked.error });
    try {
      const account = addExchange(
        ctx.db,
        request.userId,
        exchange,
        checked.keys,
        typeof label === 'string' ? label.slice(0, 40) : undefined,
      );
      void collection.readAccount(account.id);
      return {
        id: account.id,
        label: account.label,
        warning: bindingAdvice(exchange, checked.ipRestricted, await ctx.address()),
      };
    } catch (err) {
      return reply.code(400).send({ error: errorText(err) });
    }
  });

  app.put<{ Params: { id: string }; Body: KeyBody }>('/api/accounts/:id/key', async (request, reply) => {
    const id = Number(request.params.id);
    const account = listAccounts(ctx.db, request.userId).find((a) => a.id === id);
    if (!account || !isExchange(account.kind)) return reply.code(404).send({ error: 'No such exchange' });
    const checked = await checkedKeys(account.kind, request.body ?? {});
    if ('error' in checked) return reply.code(400).send({ error: checked.error });
    try {
      if (!replaceExchangeKeys(ctx.db, request.userId, id, checked.keys)) {
        return reply.code(404).send({ error: 'No such exchange' });
      }
      void collection.readAccount(id);
      return { warning: bindingAdvice(account.kind, checked.ipRestricted, await ctx.address()) };
    } catch (err) {
      return reply.code(400).send({ error: errorText(err) });
    }
  });

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
