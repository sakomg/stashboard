import { createHmac } from 'node:crypto';
import { errorText } from '../lib/errors.ts';
import { getJson, HttpError, postJson } from '../lib/http.ts';
import {
  priceFrom,
  readWallets,
  toHoldings,
  type Balance,
  type ExchangeKeys,
  type KeyCheck,
} from '../domain/exchange.ts';
import type { CollectResult } from '../domain/types.ts';

const SPOT = 'https://api.binance.com';
const USD_M = 'https://fapi.binance.com';
const COIN_M = 'https://dapi.binance.com';
const FUTURES_HIDDEN =
  'Binance does not show futures to this key. A key made before the futures account was opened never sees them. Make a new read-only key and replace this one in Accounts.';

async function binanceSigned<T>(
  keys: ExchangeKeys,
  path: string,
  options: { base?: string; method?: 'GET' | 'POST'; params?: Record<string, string | number> } = {},
): Promise<T> {
  const params = { ...options.params, timestamp: Date.now(), recvWindow: 10000 };
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  const signature = createHmac('sha256', keys.apiSecret).update(query).digest('hex');
  const url = `${options.base ?? SPOT}${path}?${query}&signature=${signature}`;
  const headers = { 'X-MBX-APIKEY': keys.apiKey };
  return options.method === 'POST' ? postJson<T>(url, headers) : getJson<T>(url, headers);
}

async function pages<T>(keys: ExchangeKeys, path: string): Promise<T[]> {
  const rows: T[] = [];
  for (let current = 1; ; current++) {
    const page = await binanceSigned<{ rows: T[]; total: number }>(keys, path, { params: { current, size: 100 } });
    rows.push(...page.rows);
    if (rows.length >= page.total || page.rows.length === 0) return rows;
  }
}

const num = (...parts: (string | undefined)[]): number => parts.reduce((s, p) => s + Number(p ?? 0), 0);

export async function collectBinance(keys: ExchangeKeys): Promise<CollectResult> {
  const warnings: string[] = [];
  let flexibleEarnRead = false;

  const funding = async (): Promise<Balance[]> => {
    const rows = await binanceSigned<
      { asset: string; free: string; locked: string; freeze: string; withdrawing: string }[]
    >(keys, '/sapi/v1/asset/get-funding-asset', { method: 'POST' });
    return rows.map((r) => ({
      wallet: 'Funding',
      type: 'wallet',
      asset: r.asset,
      quantity: num(r.free, r.locked, r.freeze, r.withdrawing),
    }));
  };
  const flexibleEarn = async (): Promise<Balance[]> => {
    const rows = await pages<{ asset: string; totalAmount: string }>(keys, '/sapi/v1/simple-earn/flexible/position');
    flexibleEarnRead = true;
    return rows.map((r) => ({ wallet: 'Earn', type: 'earn', asset: r.asset, quantity: num(r.totalAmount) }));
  };
  const lockedEarn = async (): Promise<Balance[]> => {
    const rows = await pages<{ asset: string; amount: string }>(keys, '/sapi/v1/simple-earn/locked/position');
    return rows.map((r) => ({ wallet: 'Earn', type: 'locked', asset: r.asset, quantity: num(r.amount) }));
  };
  const margin = async (): Promise<Balance[]> => {
    const acc = await binanceSigned<{ userAssets: { asset: string; netAsset: string }[] }>(
      keys,
      '/sapi/v1/margin/account',
    );
    return acc.userAssets.map((a) => ({
      wallet: 'Cross Margin',
      type: 'margin',
      asset: a.asset,
      quantity: num(a.netAsset),
    }));
  };
  const futures = (wallet: string, base: string, path: string) => async (): Promise<Balance[]> => {
    let acc: { assets: { asset: string; walletBalance: string; unrealizedProfit: string }[] };
    try {
      acc = await binanceSigned(keys, path, { base });
    } catch (err) {
      if (err instanceof HttpError && /"code":-2015\b/.test(err.body)) throw new Error(FUTURES_HIDDEN);
      throw err;
    }
    return acc.assets.map((a) => ({
      wallet,
      type: 'futures',
      asset: a.asset,
      quantity: num(a.walletBalance, a.unrealizedProfit),
    }));
  };

  const balances = await readWallets(
    [
      ['Funding', funding],
      ['Earn (flexible)', flexibleEarn],
      ['Earn (locked)', lockedEarn],
    ],
    warnings,
  );
  const flexibleEarnAssets = new Set(balances.filter((b) => b.type === 'earn').map((b) => b.asset));

  const tickerRows = await getJson<{ symbol: string; price: string }[]>(`${SPOT}/api/v3/ticker/price`);
  const tickers = new Map(tickerRows.map((t) => [t.symbol, Number(t.price)]));

  const spot = await binanceSigned<{ balances: { asset: string; free: string; locked: string }[] }>(
    keys,
    '/api/v3/account',
    { params: { omitZeroBalances: 'true' } },
  );
  for (const b of spot.balances) {
    const quantity = num(b.free, b.locked);
    const base = b.asset.startsWith('LD') ? b.asset.slice(2) : '';
    if (base && flexibleEarnAssets.has(base)) continue;
    if (base && !flexibleEarnRead && priceFrom(tickers, b.asset) === null && priceFrom(tickers, base) !== null) {
      balances.push({ wallet: 'Earn', type: 'earn', asset: base, quantity });
      continue;
    }
    balances.push({ wallet: 'Spot', type: 'wallet', asset: b.asset, quantity });
  }

  let reportedTotal: number | undefined;
  let reported = new Map<string, number>();
  try {
    const wallets = await binanceSigned<{ walletName: string; balance: string }[]>(
      keys,
      '/sapi/v1/asset/wallet/balance',
      { params: { quoteAsset: 'USDT' } },
    );
    reportedTotal = wallets.reduce((s, w) => s + Number(w.balance), 0);
    reported = new Map(wallets.map((w) => [w.walletName, Number(w.balance)]));
  } catch (err) {
    warnings.push(`total valuation could not be read: ${errorText(err)}`);
  }

  const optional: [string, () => Promise<Balance[]>][] = [
    ['Cross Margin', margin],
    ['USDⓈ-M Futures', futures('USDⓈ-M Futures', USD_M, '/fapi/v3/account')],
    ['COIN-M Futures', futures('COIN-M Futures', COIN_M, '/dapi/v1/account')],
  ];
  balances.push(
    ...(await readWallets(
      optional.filter(([wallet]) => reported.get(wallet) !== 0),
      warnings,
    )),
  );

  const priced = toHoldings('binance', balances, tickers);
  warnings.push(...priced.warnings);

  return { holdings: priced.holdings, warnings, reportedTotal };
}

const PERMISSIONS: Record<string, string> = {
  enableSpotAndMarginTrading: 'spot and margin trading',
  enableMargin: 'margin',
  enableFutures: 'futures trading',
  enableWithdrawals: 'withdrawals',
  enableInternalTransfer: 'internal transfers',
  permitsUniversalTransfer: 'universal transfers',
  enableVanillaOptions: 'options trading',
  enableFixApiTrade: 'FIX API trading',
  enableFixReadOnly: 'FIX API',
  enablePortfolioMarginTrading: 'portfolio margin trading',
};

export async function checkBinanceKey(keys: ExchangeKeys): Promise<KeyCheck> {
  let restrictions: Record<string, unknown>;
  try {
    restrictions = await binanceSigned<Record<string, unknown>>(keys, '/sapi/v1/account/apiRestrictions');
  } catch (err) {
    if (err instanceof HttpError && err.status >= 400 && err.status < 500) {
      throw new Error(
        "Binance refused the key. Check the API key and the secret, and that the key allows this server's IP address.",
      );
    }
    throw err;
  }
  const extra = Object.entries(restrictions)
    .filter(([name, on]) => on === true && name !== 'enableReading' && name !== 'ipRestrict')
    .map(([name]) => PERMISSIONS[name] ?? name);
  return { extra, ipRestricted: restrictions.ipRestrict === true };
}

export async function pingBinance(): Promise<string> {
  await getJson(`${SPOT}/api/v3/ping`);
  await getJson(`${USD_M}/fapi/v1/ping`);
  return 'spot and futures APIs are reachable from this IP';
}
