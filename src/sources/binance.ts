import { createHmac } from 'node:crypto';
import type { Config } from '../config.ts';
import { getJson, postJson } from '../http.ts';
import type { CollectResult, Holding, HoldingType } from '../types.ts';

type Keys = Config['binance'];

const SPOT = 'https://api.binance.com';
const USD_M = 'https://fapi.binance.com';
const COIN_M = 'https://dapi.binance.com';

export async function binanceSigned<T>(
  keys: Keys,
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

export function priceFrom(tickers: Map<string, number>, asset: string): number | null {
  if (asset === 'USDT') return 1;
  const direct = tickers.get(`${asset}USDT`);
  if (direct) return direct;
  for (const quote of ['USDC', 'FDUSD', 'BTC', 'ETH', 'BNB']) {
    const cross = tickers.get(`${asset}${quote}`);
    const quoteUsd = tickers.get(`${quote}USDT`);
    if (cross && quoteUsd) return cross * quoteUsd;
  }
  const inverse = tickers.get(`USDT${asset}`);
  return inverse ? 1 / inverse : null;
}

interface Balance {
  wallet: string;
  type: HoldingType;
  asset: string;
  quantity: number;
}

async function pages<T>(keys: Keys, path: string): Promise<T[]> {
  const rows: T[] = [];
  for (let current = 1; ; current++) {
    const page = await binanceSigned<{ rows: T[]; total: number }>(keys, path, { params: { current, size: 100 } });
    rows.push(...page.rows);
    if (rows.length >= page.total || page.rows.length === 0) return rows;
  }
}

const num = (...parts: (string | undefined)[]): number => parts.reduce((s, p) => s + Number(p ?? 0), 0);

export async function collectBinance(keys: Keys): Promise<CollectResult> {
  const warnings: string[] = [];
  const balances: Balance[] = [];

  const optional = async (wallet: string, read: () => Promise<Balance[]>): Promise<void> => {
    try {
      balances.push(...(await read()));
    } catch (err) {
      warnings.push(`${wallet} could not be read: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  await optional('Funding', async () => {
    const rows = await binanceSigned<
      { asset: string; free: string; locked: string; freeze: string; withdrawing: string }[]
    >(keys, '/sapi/v1/asset/get-funding-asset', { method: 'POST' });
    return rows.map((r) => ({
      wallet: 'Funding',
      type: 'wallet',
      asset: r.asset,
      quantity: num(r.free, r.locked, r.freeze, r.withdrawing),
    }));
  });

  let flexibleEarnRead = false;
  await optional('Earn (flexible)', async () => {
    const rows = await pages<{ asset: string; totalAmount: string }>(keys, '/sapi/v1/simple-earn/flexible/position');
    flexibleEarnRead = true;
    return rows.map((r) => ({ wallet: 'Earn', type: 'earn', asset: r.asset, quantity: num(r.totalAmount) }));
  });
  const flexibleEarnAssets = new Set(balances.filter((b) => b.type === 'earn').map((b) => b.asset));

  await optional('Earn (locked)', async () => {
    const rows = await pages<{ asset: string; amount: string }>(keys, '/sapi/v1/simple-earn/locked/position');
    return rows.map((r) => ({ wallet: 'Earn', type: 'locked', asset: r.asset, quantity: num(r.amount) }));
  });

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

  await optional('Cross Margin', async () => {
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
  });

  for (const [wallet, base, path] of [
    ['USDⓈ-M Futures', USD_M, '/fapi/v3/account'],
    ['COIN-M Futures', COIN_M, '/dapi/v1/account'],
  ] as const) {
    await optional(wallet, async () => {
      const acc = await binanceSigned<{ assets: { asset: string; walletBalance: string; unrealizedProfit: string }[] }>(
        keys,
        path,
        {
          base,
        },
      );
      return acc.assets.map((a) => ({
        wallet,
        type: 'futures',
        asset: a.asset,
        quantity: num(a.walletBalance, a.unrealizedProfit),
      }));
    });
  }

  const holdings: Holding[] = [];
  for (const b of balances) {
    if (b.quantity === 0) continue;
    const price = priceFrom(tickers, b.asset);
    if (price === null) {
      warnings.push(`no price for ${b.quantity} ${b.asset} in ${b.wallet}`);
      continue;
    }
    holdings.push({
      chain: 'binance',
      protocol: b.wallet,
      symbol: b.asset,
      quantity: b.quantity,
      price,
      value: b.quantity * price,
      type: b.quantity < 0 ? 'borrow' : b.type,
    });
  }

  let reportedTotal: number | undefined;
  try {
    const wallets = await binanceSigned<{ balance: string }[]>(keys, '/sapi/v1/asset/wallet/balance', {
      params: { quoteAsset: 'USDT' },
    });
    reportedTotal = wallets.reduce((s, w) => s + Number(w.balance), 0);
  } catch (err) {
    warnings.push(`total valuation could not be read: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { holdings, warnings, reportedTotal };
}
