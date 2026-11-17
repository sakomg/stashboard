import { createHmac } from 'node:crypto';
import { errorText } from '../lib/errors.ts';
import { getJson, HttpError } from '../lib/http.ts';
import { readWallets, toHoldings, type Balance, type ExchangeKeys, type KeyCheck } from '../domain/exchange.ts';
import type { CollectResult, HoldingType } from '../domain/types.ts';

const BYBIT_HOSTS = [
  'api.bybit.com',
  'api.bybit.tr',
  'api.bybit.kz',
  'api.bybitgeorgia.ge',
  'api.bybit.ae',
  'api.bybit.id',
];

const RECV_WINDOW = '10000';
const UNKNOWN_KEY = 10003;

const REFUSED: Record<number, string> = {
  10002: "Bybit refused the request: this server's clock is off. Sync it and try again.",
  10004: 'Bybit refused the key: the secret does not match it.',
  10010: "Bybit refused the key: it does not allow this server's IP address.",
  33004: 'Bybit refused the key: it has expired.',
  [-2015]: 'Bybit refused the key: it has expired.',
};

class BybitError extends Error {
  readonly code: number;

  constructor(host: string, code: number, message: string) {
    super(`${host} → ${code}: ${message}`);
    this.code = code;
  }
}

interface Reply<T> {
  retCode: number;
  retMsg: string;
  result: T;
}

const hostOf = (keys: ExchangeKeys): string => keys.host ?? BYBIT_HOSTS[0]!;

async function bybitPublic<T>(host: string, path: string): Promise<T> {
  const reply = await getJson<Reply<T>>(`https://${host}${path}`);
  if (reply.retCode !== 0) throw new BybitError(host, reply.retCode, reply.retMsg);
  return reply.result;
}

async function bybitSigned<T>(
  keys: ExchangeKeys,
  path: string,
  params: Record<string, string> = {},
  host = hostOf(keys),
): Promise<T> {
  const query = new URLSearchParams(params).toString();
  const timestamp = String(Date.now());
  const sign = createHmac('sha256', keys.apiSecret)
    .update(timestamp + keys.apiKey + RECV_WINDOW + query)
    .digest('hex');
  const reply = await getJson<Reply<T>>(`https://${host}${path}${query ? `?${query}` : ''}`, {
    'X-BAPI-API-KEY': keys.apiKey,
    'X-BAPI-TIMESTAMP': timestamp,
    'X-BAPI-SIGN': sign,
    'X-BAPI-RECV-WINDOW': RECV_WINDOW,
  });
  if (reply.retCode !== 0) throw new BybitError(host, reply.retCode, reply.retMsg);
  return reply.result;
}

const PERMISSIONS: Record<string, string> = {
  Order: 'contract trading',
  Position: 'contract trading',
  SpotTrade: 'spot trading',
  OptionsTrade: 'options trading',
  DerivativesTrade: 'derivatives trading',
  AccountTransfer: 'transfers',
  SubMemberTransfer: 'transfers',
  SubMemberTransferList: 'transfers',
  Withdraw: 'withdrawals',
  ExchangeHistory: 'convert',
  Earn: 'Earn',
};

interface KeyInfo {
  readOnly: number;
  ips?: string[];
  permissions?: Record<string, string[]>;
}

const unknownKey = (err: unknown): boolean =>
  (err instanceof BybitError && err.code === UNKNOWN_KEY) || (err instanceof HttpError && err.status === 401);

export async function checkBybitKey(keys: ExchangeKeys): Promise<KeyCheck> {
  const hosts = keys.host ? [keys.host] : BYBIT_HOSTS;
  const answers = await Promise.allSettled(
    hosts.map((host) => bybitSigned<KeyInfo>(keys, '/v5/user/query-api', {}, host)),
  );
  for (const [i, answer] of answers.entries()) {
    if (answer.status !== 'fulfilled') continue;
    const info = answer.value;
    const writes = [
      ...new Set(
        Object.values(info.permissions ?? {})
          .flat()
          .map((p) => PERMISSIONS[p] ?? p),
      ),
    ];
    const ips = info.ips ?? [];
    return {
      extra: info.readOnly === 1 ? [] : writes.length > 0 ? writes : ['read and write'],
      ipRestricted: ips.length > 0 && !ips.includes('*'),
      host: hosts[i],
    };
  }
  const errors = answers.map((a) => (a.status === 'rejected' ? a.reason : null));
  const known = errors.find((err) => err instanceof BybitError && REFUSED[err.code]);
  if (known instanceof BybitError) throw new Error(REFUSED[known.code]);
  const other = errors.find((err) => !unknownKey(err));
  if (other) throw other instanceof Error ? other : new Error(errorText(other));
  throw new Error(
    "Bybit refused the key. Check the API key and the secret, and that the key allows this server's IP address.",
  );
}

export async function pingBybit(): Promise<string> {
  await bybitPublic(BYBIT_HOSTS[0]!, '/v5/market/time');
  return 'market API is reachable from this IP';
}

const num = (value: string | undefined): number => Number(value || 0);

export async function collectBybit(keys: ExchangeKeys): Promise<CollectResult> {
  const host = hostOf(keys);
  const warnings: string[] = [];

  const unified = await bybitSigned<{ list: { coin: { coin: string; equity: string; usdValue: string }[] }[] }>(
    keys,
    '/v5/account/wallet-balance',
    { accountType: 'UNIFIED' },
  );
  const balances: Balance[] = unified.list.flatMap((account) =>
    account.coin.map((c) => ({
      wallet: 'Unified Trading',
      type: 'wallet' as const,
      asset: c.coin,
      quantity: num(c.equity),
      usd: num(c.usdValue),
    })),
  );

  const funding = async (): Promise<Balance[]> => {
    const wallet = await bybitSigned<{ balance: { coin: string; walletBalance: string }[] }>(
      keys,
      '/v5/asset/transfer/query-account-coins-balance',
      { accountType: 'FUND' },
    );
    return wallet.balance.map((b) => ({
      wallet: 'Funding',
      type: 'wallet',
      asset: b.coin,
      quantity: num(b.walletBalance),
    }));
  };
  const earn = (category: string, type: HoldingType) => async (): Promise<Balance[]> => {
    const positions = await bybitSigned<{ list: { coin: string; amount: string }[] }>(keys, '/v5/earn/position', {
      category,
    });
    return positions.list.map((p) => ({ wallet: 'Earn', type, asset: p.coin, quantity: num(p.amount) }));
  };
  balances.push(
    ...(await readWallets(
      [
        ['Funding', funding],
        ['Earn (flexible)', earn('FlexibleSaving', 'earn')],
        ['Earn (on-chain)', earn('OnChain', 'staked')],
      ],
      warnings,
    )),
  );

  const tickers = await bybitPublic<{ list: { symbol: string; lastPrice: string }[] }>(
    host,
    '/v5/market/tickers?category=spot',
  );
  const priced = toHoldings('bybit', balances, new Map(tickers.list.map((t) => [t.symbol, Number(t.lastPrice)])));
  warnings.push(...priced.warnings);

  let reportedTotal: number | undefined;
  if (host === BYBIT_HOSTS[0]) {
    try {
      const overview = await bybitSigned<{ totalEquity: string }>(keys, '/v5/asset/asset-overview');
      reportedTotal = Number(overview.totalEquity);
    } catch (err) {
      warnings.push(`total valuation could not be read: ${errorText(err)}`);
    }
  }

  return { holdings: priced.holdings, warnings, reportedTotal };
}
