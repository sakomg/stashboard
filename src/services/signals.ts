import type { DatabaseSync } from 'node:sqlite';
import { STOCKS_CATEGORY, type Asset } from '../domain/assets.ts';
import type { Config } from '../lib/config.ts';
import { currentState, saveSignals, type SignalRow } from '../storage/index.ts';
import { heatScore, type Readings } from '../domain/heat.ts';
import { rsi, sma } from '../domain/indicators.ts';
import { buildPortfolio } from '../domain/portfolio.ts';
import { closes, funding8hPct, listMarkets, openInterestChange7dPct, type Markets } from '../sources/market.ts';

const MIN_VALUE_USD = 1;
const NO_SIGNALS = new Set(['Stablecoins']);

export interface Pair {
  candles: { market: 'spot' | 'futures'; symbol: string } | null;
  perp: string | null;
}

export function findPair(asset: Asset, markets: Markets): Pair {
  const stock = asset.category === STOCKS_CATEGORY;
  const spot = [`${asset.key}USDT`, ...(stock ? [`${asset.key}BUSDT`] : [])].find((s) => markets.spot.has(s));
  const perp = stock ? undefined : [`${asset.key}USDT`, `1000${asset.key}USDT`].find((s) => markets.futures.has(s));
  const candles = spot
    ? { market: 'spot' as const, symbol: spot }
    : perp
      ? { market: 'futures' as const, symbol: perp }
      : null;
  return { candles, perp: perp ?? null };
}

async function readings(pair: Pair): Promise<Readings> {
  const result: Readings = { rsiDaily: null, rsiWeekly: null, funding: null, ma200: null, oiGrowth: null };
  if (!pair.candles) return result;

  const { market, symbol } = pair.candles;
  const daily = await closes(market, symbol, '1d', 300);
  const weekly = await closes(market, symbol, '1w', 150);
  result.rsiDaily = rsi(daily);
  result.rsiWeekly = rsi(weekly);
  const average = sma(daily, 200);
  const last = daily.at(-1);
  if (average && last) result.ma200 = (last / average - 1) * 100;

  if (pair.perp) {
    result.funding = await funding8hPct(pair.perp);
    const growth = await openInterestChange7dPct(pair.perp);
    const weekAgo = daily.at(-8);
    if (growth !== null && last && weekAgo) result.oiGrowth = last > weekAgo ? growth : 0;
  }
  return result;
}

export async function runSignals(
  db: DatabaseSync,
  config: Config,
  resolve: (symbol: string) => Asset,
): Promise<SignalRow[]> {
  const { assets } = buildPortfolio(currentState(db, 'all'), resolve);
  const markets = await listMarkets();
  const time = new Date().toISOString();
  const rows: SignalRow[] = [];

  for (const asset of assets) {
    if (Math.abs(asset.value) < MIN_VALUE_USD || NO_SIGNALS.has(asset.category)) continue;
    const pair = findPair(asset, markets);
    if (!pair.candles) continue;
    try {
      const heat = heatScore(await readings(pair), config.heat);
      if (heat) rows.push({ asset: asset.key, time, pair: pair.candles.symbol, ...heat });
    } catch (err) {
      console.warn(`signals: ${asset.key} skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  saveSignals(db, rows);
  return rows;
}
