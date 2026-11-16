import type { Holding, HoldingType } from './types.ts';

export const EXCHANGES = { binance: 'Binance', bybit: 'Bybit', okx: 'OKX' } as const;
export type ExchangeKind = keyof typeof EXCHANGES;
export const EXCHANGE_KINDS = Object.keys(EXCHANGES) as ExchangeKind[];

export const isExchange = (kind: string): kind is ExchangeKind => Object.hasOwn(EXCHANGES, kind);

export interface ExchangeKeys {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  host?: string;
}

export interface KeyCheck {
  extra: string[];
  ipRestricted: boolean;
  host?: string;
}

export interface Balance {
  wallet: string;
  type: HoldingType;
  asset: string;
  quantity: number;
  usd?: number;
}

const QUOTES = ['USDC', 'FDUSD', 'BTC', 'ETH', 'BNB'];

export function priceFrom(tickers: Map<string, number>, asset: string): number | null {
  if (asset === 'USDT') return 1;
  const direct = tickers.get(`${asset}USDT`);
  if (direct) return direct;
  for (const quote of QUOTES) {
    const cross = tickers.get(`${asset}${quote}`);
    const quoteUsd = tickers.get(`${quote}USDT`);
    if (cross && quoteUsd) return cross * quoteUsd;
  }
  const inverse = tickers.get(`USDT${asset}`);
  return inverse ? 1 / inverse : null;
}

export function toHoldings(
  chain: string,
  balances: Balance[],
  tickers: Map<string, number>,
): { holdings: Holding[]; warnings: string[] } {
  const holdings: Holding[] = [];
  const warnings: string[] = [];
  for (const b of balances) {
    if (!Number.isFinite(b.quantity) || b.quantity === 0) continue;
    const price = priceFrom(tickers, b.asset) ?? (b.usd ? Math.abs(b.usd / b.quantity) : null);
    if (price === null) {
      warnings.push(`no price for ${b.quantity} ${b.asset} in ${b.wallet}`);
      continue;
    }
    holdings.push({
      chain,
      protocol: b.wallet,
      symbol: b.asset,
      quantity: b.quantity,
      price,
      value: b.quantity * price,
      type: b.quantity < 0 ? 'borrow' : b.type,
    });
  }
  return { holdings, warnings };
}

export const failure = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export async function readWallets(
  readers: [string, () => Promise<Balance[]>][],
  warnings: string[],
): Promise<Balance[]> {
  const balances: Balance[] = [];
  for (const [wallet, read] of readers) {
    try {
      balances.push(...(await read()));
    } catch (err) {
      warnings.push(`${wallet} could not be read: ${failure(err)}`);
    }
  }
  return balances;
}
