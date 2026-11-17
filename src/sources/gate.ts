import { createHash, createHmac } from 'node:crypto';
import { getJson, HttpError } from '../lib/http.ts';
import {
  failure,
  readWallets,
  toHoldings,
  type Balance,
  type ExchangeKeys,
  type KeyCheck,
} from '../domain/exchange.ts';
import type { CollectResult } from '../domain/types.ts';

export const GATE_HOST = 'api.gateio.ws';

const PREFIX = '/api/v4';
const EMPTY_BODY = createHash('sha512').update('').digest('hex');
const PAGE = 100;
const MAX_PAGES = 20;

const REFUSED: Record<string, string> = {
  INVALID_SIGNATURE: 'Gate refused the key: the secret does not match it.',
  IP_FORBIDDEN: "Gate refused the key: it does not allow this server's IP address.",
  REQUEST_EXPIRED: "Gate refused the request: this server's clock is off. Sync it and try again.",
  ACCOUNT_LOCKED: 'Gate refused the key: the account is locked.',
};

const UNKNOWN_KEY = new Set(['INVALID_KEY', 'INVALID_CREDENTIALS']);

const UNCHECKED =
  "Gate did not list this key's permissions, so it cannot be checked to be read-only. Create the key on the main account and set Account to Read Only.";

export class GateError extends Error {
  readonly label: string;

  constructor(label: string, message: string) {
    super(`${GATE_HOST} → ${label}: ${message}`);
    this.label = label;
  }
}

const queryOf = (params: Record<string, string | number>): string =>
  Object.entries(params)
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

async function request<T>(path: string, query: string, headers: Record<string, string> = {}): Promise<T> {
  try {
    return await getJson<T>(`https://${GATE_HOST}${PREFIX}${path}${query ? `?${query}` : ''}`, headers);
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    let body: { label?: string; message?: string; detail?: string } = {};
    try {
      body = JSON.parse(err.body) as typeof body;
    } catch {
      throw err;
    }
    if (!body.label) throw err;
    throw new GateError(body.label, body.message ?? body.detail ?? '');
  }
}

export function gateSigned<T>(
  keys: ExchangeKeys,
  path: string,
  params: Record<string, string | number> = {},
): Promise<T> {
  const query = queryOf(params);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sign = createHmac('sha512', keys.apiSecret)
    .update(['GET', PREFIX + path, query, EMPTY_BODY, timestamp].join('\n'))
    .digest('hex');
  return request<T>(path, query, { KEY: keys.apiKey, Timestamp: timestamp, SIGN: sign });
}

const PERMISSIONS: Record<string, string> = {
  wallet: 'transfers',
  withdraw: 'withdrawals',
  spot: 'spot trading',
  margin: 'margin trading',
  futures: 'futures trading',
  delivery: 'delivery trading',
  options: 'options trading',
  unified: 'unified account changes',
  earn: 'Earn subscriptions',
  loan: 'loans',
  copy: 'copy trading',
  account: 'account changes',
  sub_accounts: 'sub-account changes',
};

interface KeyInfo {
  key: string;
  perms?: { name: string; read_only: boolean }[];
  ip_whitelist?: string[];
}

const isKey = (apiKey: string) => (info: KeyInfo) => {
  const parts = info.key.split(/\*+/);
  if (parts.join('').length < 8) return false;
  const pattern = parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${pattern}$`).test(apiKey);
};

export async function checkGateKey(keys: ExchangeKeys): Promise<KeyCheck> {
  let listed: KeyInfo[];
  try {
    listed = await gateSigned<KeyInfo[]>(keys, '/account/main_keys');
  } catch (err) {
    if (err instanceof GateError && REFUSED[err.label]) throw new Error(REFUSED[err.label]);
    if (err instanceof GateError && UNKNOWN_KEY.has(err.label)) {
      throw new Error(
        "Gate refused the key. Check the API key and the secret, and that the key allows this server's IP address.",
      );
    }
    if (err instanceof GateError && err.label === 'FORBIDDEN') throw new Error(UNCHECKED);
    throw err;
  }
  const own = listed.filter(isKey(keys.apiKey));
  if (own.length === 0) throw new Error(UNCHECKED);
  const extra = own.flatMap((info) =>
    (info.perms ?? []).filter((p) => !p.read_only).map((p) => PERMISSIONS[p.name] ?? p.name),
  );
  return {
    extra: [...new Set(extra)],
    ipRestricted: own.every((info) => (info.ip_whitelist ?? []).length > 0),
  };
}

export async function pingGate(): Promise<string> {
  await request('/spot/time', '');
  return 'market API is reachable from this IP';
}

const num = (value: string | number | undefined): number => Number(value || 0);

const UNIFIED_MODES = new Set(['single_currency', 'multi_currency', 'portfolio']);

interface UnifiedAccount {
  mode?: string;
  use_funding?: boolean;
  balances?: Record<string, { equity?: string; iso_balance?: string; funding?: string }>;
}

async function unifiedAccount(keys: ExchangeKeys): Promise<UnifiedAccount | null> {
  try {
    const account = await gateSigned<UnifiedAccount>(keys, '/unified/accounts');
    return UNIFIED_MODES.has(account.mode ?? '') ? account : null;
  } catch (err) {
    if (err instanceof GateError) return null;
    throw err;
  }
}

async function pages<T>(read: (page: number) => Promise<{ rows: T[]; total?: number }>): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const current = await read(page);
    rows.push(...current.rows);
    if (current.rows.length < PAGE || (current.total !== undefined && rows.length >= current.total)) break;
  }
  return rows;
}

export async function collectGate(keys: ExchangeKeys): Promise<CollectResult> {
  const warnings: string[] = [];

  const unified = await unifiedAccount(keys);
  const balances: Balance[] = unified
    ? Object.entries(unified.balances ?? {}).map(([asset, b]) => ({
        wallet: 'Unified',
        type: 'wallet' as const,
        asset,
        quantity: num(b.equity) + num(b.iso_balance) - (unified.use_funding ? num(b.funding) : 0),
      }))
    : (await gateSigned<{ currency: string; available: string; locked: string }[]>(keys, '/spot/accounts')).map(
        (r) => ({
          wallet: 'Spot',
          type: 'wallet' as const,
          asset: r.currency,
          quantity: num(r.available) + num(r.locked),
        }),
      );

  const futures = (settle: string) => async (): Promise<Balance[]> => {
    try {
      const account = await gateSigned<{ currency: string; total: string; unrealised_pnl: string }>(
        keys,
        `/futures/${settle}/accounts`,
      );
      return [
        {
          wallet: 'Futures',
          type: 'futures',
          asset: account.currency,
          quantity: num(account.total) + num(account.unrealised_pnl),
        },
      ];
    } catch (err) {
      if (err instanceof GateError && err.label === 'USER_NOT_FOUND') return [];
      throw err;
    }
  };
  const simpleEarn = async (): Promise<Balance[]> => {
    const rows = await pages(async (page) => ({
      rows: await gateSigned<{ currency: string; amount: string }[]>(keys, '/earn/uni/lends', { page, limit: PAGE }),
    }));
    return rows.map((r) => ({ wallet: 'Earn', type: 'earn', asset: r.currency, quantity: num(r.amount) }));
  };
  const fixedTerm = async (): Promise<Balance[]> => {
    const rows = await pages(async (page) => {
      const reply = await gateSigned<{
        code: number;
        message: string;
        data?: { list?: { asset: string; principal: string; status: number }[]; total?: number };
      }>(keys, '/earn/fixed-term/user/lend', { order_type: 1, page, limit: PAGE });
      if (reply.code !== 0) throw new GateError(String(reply.code), reply.message);
      return { rows: reply.data?.list ?? [], total: reply.data?.total };
    });
    return rows
      .filter((r) => r.status === 1)
      .map((r) => ({ wallet: 'Earn', type: 'locked', asset: r.asset, quantity: num(r.principal) }));
  };
  const staking = async (): Promise<Balance[]> => {
    const rows = await gateSigned<{ mortgage_coin: string; mortgage_amount: string; type: number }[]>(
      keys,
      '/earn/staking/assets',
    );
    return rows
      .filter((r) => r.type !== 0)
      .flatMap((r) => {
        if (r.mortgage_coin.includes(',')) {
          warnings.push(`a staking position in ${r.mortgage_coin} is not read`);
          return [];
        }
        return [{ wallet: 'Earn', type: 'staked' as const, asset: r.mortgage_coin, quantity: num(r.mortgage_amount) }];
      });
  };
  const optional: [string, () => Promise<Balance[]>][] = [
    ['Futures (BTC)', futures('btc')],
    ['Earn (simple)', simpleEarn],
    ['Earn (fixed)', fixedTerm],
    ['Earn (staking)', staking],
  ];
  if (!unified) optional.unshift(['Futures (USDT)', futures('usdt')]);
  balances.push(...(await readWallets(optional, warnings)));

  const tickers = await request<{ currency_pair: string; last: string }[]>('/spot/tickers', '');
  const priced = toHoldings(
    'gate',
    balances,
    new Map(tickers.map((t) => [t.currency_pair.replace('_', ''), Number(t.last)])),
  );
  warnings.push(...priced.warnings);

  let reportedTotal: number | undefined;
  try {
    const valuation = await gateSigned<{ total?: { amount: string } }>(keys, '/wallet/total_balance', {
      currency: 'USDT',
    });
    if (valuation.total) reportedTotal = Number(valuation.total.amount);
  } catch (err) {
    warnings.push(`total valuation could not be read: ${failure(err)}`);
  }

  return { holdings: priced.holdings, warnings, reportedTotal };
}
