import { getJson, sendJson } from '../lib/http.ts';
import type { CollectResult, Holding, HoldingType } from '../domain/types.ts';

const ASTER_PROTOCOL = 'Aster';
const CHAIN = 'aster';
const RPC = 'https://tapi.asterdex.com/info';
const SPOT_PRICES = 'https://sapi.asterdex.com/api/v1/ticker/price';
const FUTURES_PRICES = 'https://fapi.asterdex.com/fapi/v1/ticker/price';
const LOGO = 'https://static.asterdexfx.com/cloud-futures/static/images/aster/apple-touch-icon.png';
const STAKED_ASSET = 'ASTER';
const BASE_QUOTE = 'USDT';
const QUOTES = [BASE_QUOTE, 'USD1', 'USDF', 'USDC'];

type Amount = number | string | null | undefined;

interface AsterBalance {
  accountPrivacy?: string;
  perpAssets?: { asset: string; walletBalance: Amount }[];
  spotAssets?: { asset: string; walletBalance: Amount }[];
  positions?: { tradingProduct?: string; positions?: { unrealizedProfit?: Amount }[] }[];
  staking?: { totalStakedAmount?: Amount; totalPendingStakeAmount?: Amount; totalPendingUnstakeAmount?: Amount } | null;
}

interface Ticker {
  symbol: string;
  price: string;
}

const amount = (value: Amount): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function asterPrices(...markets: Ticker[][]): Map<string, number> {
  const prices = new Map<string, number>([[BASE_QUOTE, 1]]);
  for (const tickers of markets) {
    for (const quote of QUOTES) {
      const rate = prices.get(quote);
      if (!rate) continue;
      for (const t of tickers) {
        if (!t.symbol.endsWith(quote) || t.symbol === quote) continue;
        const base = t.symbol.slice(0, -quote.length);
        const price = Number(t.price) * rate;
        if (!prices.has(base) && Number.isFinite(price) && price > 0) prices.set(base, price);
      }
    }
  }
  return prices;
}

export function asterHoldings(balance: AsterBalance, prices: Map<string, number>): CollectResult {
  if (balance.accountPrivacy !== 'disabled') return { holdings: [], warnings: [] };
  const holdings: Holding[] = [];
  let unpriced = 0;
  const add = (symbol: string, quantity: number, type: HoldingType): void => {
    if (quantity === 0) return;
    const price = prices.get(symbol.toUpperCase());
    if (!price) {
      unpriced++;
      return;
    }
    const value = quantity * price;
    holdings.push({
      chain: CHAIN,
      protocol: ASTER_PROTOCOL,
      symbol,
      quantity,
      price,
      value,
      type: value < 0 ? 'borrow' : type,
    });
  };

  const pnl = (balance.positions ?? [])
    .filter((group) => group.tradingProduct === 'perps')
    .flatMap((group) => group.positions ?? [])
    .reduce((sum, p) => sum + amount(p.unrealizedProfit), 0);
  const perps = new Map((balance.perpAssets ?? []).map((a) => [a.asset, amount(a.walletBalance)]));
  perps.set(BASE_QUOTE, (perps.get(BASE_QUOTE) ?? 0) + pnl);
  for (const [symbol, quantity] of perps) add(symbol, quantity, 'futures');
  for (const a of balance.spotAssets ?? []) add(a.asset, amount(a.walletBalance), 'wallet');
  add(STAKED_ASSET, stakedAmount(balance), 'staked');

  return {
    holdings,
    warnings: unpriced > 0 ? [`${unpriced} Aster assets without a price skipped`] : [],
  };
}

const stakedAmount = (balance: AsterBalance): number =>
  amount(balance.staking?.totalStakedAmount) +
  amount(balance.staking?.totalPendingStakeAmount) +
  amount(balance.staking?.totalPendingUnstakeAmount);

const needsPrices = (balance: AsterBalance): boolean =>
  balance.accountPrivacy === 'disabled' &&
  (stakedAmount(balance) !== 0 ||
    [...(balance.perpAssets ?? []), ...(balance.spotAssets ?? [])].some(
      (a) => a.asset !== BASE_QUOTE && amount(a.walletBalance) !== 0,
    ));

export const isMissingAccount = (error: { message?: string }): boolean =>
  /account does not exist/i.test(error.message ?? '');

export async function collectAster(address: string): Promise<CollectResult> {
  const answer = await sendJson<{ result?: AsterBalance; error?: { message?: string } }>(RPC, {
    jsonrpc: '2.0',
    id: 1,
    method: 'aster_getBalance',
    params: [address, 'latest'],
  });
  if (answer.error && isMissingAccount(answer.error)) return { holdings: [], warnings: [] };
  if (answer.error) throw new Error(`Aster: ${answer.error.message ?? 'the balance could not be read'}`);
  const balance = answer.result ?? {};
  const markets = needsPrices(balance)
    ? [await getJson<Ticker[]>(SPOT_PRICES), await getJson<Ticker[]>(FUTURES_PRICES)]
    : [];
  const result = asterHoldings(balance, asterPrices(...markets));
  return {
    ...result,
    logos:
      result.holdings.length > 0
        ? [
            { kind: 'protocol', key: ASTER_PROTOCOL, url: LOGO },
            { kind: 'chain', key: CHAIN, url: LOGO, name: 'Aster' },
          ]
        : [],
  };
}
