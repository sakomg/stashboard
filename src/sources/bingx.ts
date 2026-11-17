import { createHmac } from 'node:crypto';
import { errorText } from '../lib/errors.ts';
import { getJson, HttpError } from '../lib/http.ts';
import { readWallets, toHoldings, type Balance, type ExchangeKeys, type KeyCheck } from '../domain/exchange.ts';
import type { CollectResult } from '../domain/types.ts';

const BINGX_HOST = 'open-api.bingx.com';

const REFUSED: Record<number, string> = {
  100001: 'BingX refused the key: the secret does not match it.',
  100004: 'BingX refused the key: it may not read the account. Tick Read on the key.',
  100413: 'BingX refused the key: it does not know this API key.',
  100419: "BingX refused the key: it does not allow this server's IP address.",
  100421: "BingX refused the request: this server's clock is off. Sync it and try again.",
};

const UNCHECKED = "BingX did not list this key's permissions, so it cannot be checked to be read-only.";

class BingxError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(`${BINGX_HOST} → ${code}: ${message}`);
    this.code = code;
  }
}

interface Reply<T> {
  code: number | string;
  msg?: string;
  data: T;
}

const wrapped = <T>(body: unknown): body is Reply<T> => typeof body === 'object' && body !== null && 'code' in body;

async function request<T>(path: string, query = '', headers: Record<string, string> = {}): Promise<T> {
  let reply: unknown;
  try {
    reply = await getJson(`https://${BINGX_HOST}${path}${query ? `?${query}` : ''}`, headers);
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    let body: Partial<Reply<T>> = {};
    try {
      body = JSON.parse(err.body) as Partial<Reply<T>>;
    } catch {
      throw err;
    }
    if (!Number(body.code)) throw err;
    throw new BingxError(Number(body.code), body.msg ?? '');
  }
  if (!wrapped<T>(reply)) return reply as T;
  if (Number(reply.code) !== 0) throw new BingxError(Number(reply.code), reply.msg ?? '');
  return reply.data;
}

function bingxSigned<T>(keys: ExchangeKeys, path: string): Promise<T> {
  const query = `timestamp=${Date.now()}`;
  const signature = createHmac('sha256', keys.apiSecret).update(query).digest('hex');
  return request<T>(path, `${query}&signature=${signature}`, { 'X-BX-APIKEY': keys.apiKey });
}

const READ = 2;

const PERMISSIONS: Record<number, string> = {
  1: 'spot trading',
  3: 'futures trading',
  4: 'transfers',
  5: 'withdrawals',
  7: 'sub-account transfers',
};

export async function checkBingxKey(keys: ExchangeKeys): Promise<KeyCheck> {
  let info: { permissions?: (number | string)[]; ipAddresses?: string[] };
  try {
    info = await bingxSigned(keys, '/openApi/v1/account/apiPermissions');
  } catch (err) {
    if (err instanceof BingxError && REFUSED[err.code]) throw new Error(REFUSED[err.code]);
    throw err;
  }
  if (!Array.isArray(info.permissions)) throw new Error(UNCHECKED);
  const extra = info.permissions
    .map(Number)
    .filter((p) => p !== READ)
    .map((p) => PERMISSIONS[p] ?? `permission ${p}`);
  return {
    extra: [...new Set(extra)],
    ipRestricted: (info.ipAddresses ?? []).some((ip) => ip.trim()),
  };
}

export async function pingBingx(): Promise<string> {
  await request('/openApi/spot/v1/server/time');
  return 'market API is reachable from this IP';
}

const num = (value: string | number | undefined): number => Number(value || 0);

interface Coin {
  asset: string;
  free: string;
  locked: string;
}

const coins = (wallet: string, rows: Coin[] = []): Balance[] =>
  rows.map((r) => ({ wallet, type: 'wallet', asset: r.asset, quantity: num(r.free) + num(r.locked) }));

const READ_ACCOUNTS = new Set(['sopt', 'spot', 'fund', 'USDTMPerp', 'coinMPerp', 'stdFutures']);

const UNREAD: Record<string, string> = {
  copyTrading: 'Copy trading',
  grid: 'Grid bots',
  eran: 'Earn',
  c2c: 'P2P',
};

export async function collectBingx(keys: ExchangeKeys): Promise<CollectResult> {
  const warnings: string[] = [];

  const spot = await bingxSigned<{ balances?: Coin[] }>(keys, '/openApi/spot/v1/account/balance');
  const balances = coins('Spot', spot.balances);

  const funding = async (): Promise<Balance[]> => {
    const fund = await bingxSigned<{ assets?: Coin[]; balances?: Coin[] }>(keys, '/openApi/fund/v1/account/balance');
    return coins('Funding', fund.assets ?? fund.balances);
  };
  const perpetual = (wallet: string, path: string) => async (): Promise<Balance[]> => {
    const rows = await bingxSigned<{ asset: string; equity: string }[]>(keys, path);
    return rows.map((r) => ({ wallet, type: 'futures', asset: r.asset, quantity: num(r.equity) }));
  };
  const standard = async (): Promise<Balance[]> => {
    const rows = await bingxSigned<{ asset: string; balance: string; crossUnPnl?: string }[]>(
      keys,
      '/openApi/contract/v1/balance',
    );
    return rows.map((r) => ({
      wallet: 'Standard Futures',
      type: 'futures',
      asset: r.asset,
      quantity: num(r.balance) + num(r.crossUnPnl),
    }));
  };
  balances.push(
    ...(await readWallets(
      [
        ['Funding', funding],
        ['Perpetual Futures', perpetual('Perpetual Futures', '/openApi/swap/v3/user/balance')],
        ['Coin-M Futures', perpetual('Coin-M Futures', '/openApi/cswap/v1/user/balance')],
        ['Standard Futures', standard],
      ],
      warnings,
    )),
  );

  const tickers = await request<{ symbol: string; lastPrice: string | number }[]>('/openApi/spot/v2/quote/ticker');
  const priced = toHoldings(
    'bingx',
    balances,
    new Map(tickers.map((t) => [t.symbol.replace('-', ''), Number(t.lastPrice)])),
  );
  warnings.push(...priced.warnings);

  let reportedTotal: number | undefined;
  try {
    const overview = await bingxSigned<
      { accountType: string; usdtBalance: string }[] | { result?: { accountType: string; usdtBalance: string }[] }
    >(keys, '/openApi/account/v1/allAccountBalance');
    const accounts = Array.isArray(overview) ? overview : (overview.result ?? []);
    reportedTotal = accounts.reduce((sum, a) => sum + num(a.usdtBalance), 0);
    for (const a of accounts) {
      if (READ_ACCOUNTS.has(a.accountType) || num(a.usdtBalance) < 1) continue;
      warnings.push(
        `${UNREAD[a.accountType] ?? a.accountType}, worth ${Math.round(num(a.usdtBalance))} USDT, is not read`,
      );
    }
  } catch (err) {
    warnings.push(`total valuation could not be read: ${errorText(err)}`);
  }

  return { holdings: priced.holdings, warnings, reportedTotal };
}
