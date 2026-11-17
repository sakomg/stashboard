import type { DatabaseSync } from 'node:sqlite';
import { errorText } from '../lib/errors.ts';
import { STABLECOINS_CATEGORY, STOCKS_CATEGORY, type Asset } from '../domain/assets.ts';
import type { Config } from '../lib/config.ts';
import { currentState, savePriceChanges, saveSignals, type PriceChange, type SignalRow } from '../storage/index.ts';
import { heatScore, type Readings } from '../domain/heat.ts';
import { priceChange, rsi, sma } from '../domain/indicators.ts';
import { buildPortfolio } from '../domain/portfolio.ts';
import {
  change24h,
  closes,
  funding8hPct,
  listMarkets,
  openInterestChange7dPct,
  type Markets,
} from '../sources/market.ts';

const MIN_VALUE_USD = 1;
const NO_SIGNALS = new Set([STABLECOINS_CATEGORY]);

interface Pair {
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

async function readings(pair: Pair, daily: number[]): Promise<Readings> {
  const result: Readings = { rsiDaily: null, rsiWeekly: null, funding: null, ma200: null, oiGrowth: null };
  if (!pair.candles) return result;

  const { market, symbol } = pair.candles;
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
  only?: Set<string>,
): Promise<SignalRow[]> {
  const assets = buildPortfolio(currentState(db, 'all'), resolve).assets.filter((a) => !only || only.has(a.key));
  if (assets.length === 0) return [];
  const markets = await listMarkets();
  const time = new Date().toISOString();
  const rows: SignalRow[] = [];
  const moves: PriceChange[] = [];

  for (const asset of assets) {
    if (Math.abs(asset.value) < MIN_VALUE_USD || NO_SIGNALS.has(asset.category)) continue;
    const pair = findPair(asset, markets);
    if (!pair.candles) continue;
    try {
      const { market, symbol } = pair.candles;
      const daily = await closes(market, symbol, '1d', 300);
      const d1 = await change24h(market, symbol);
      moves.push({ asset: asset.key, time, d1, d7: priceChange(daily, 7), d30: priceChange(daily, 30) });
      const heat = heatScore(await readings(pair, daily), config.heat);
      if (heat) rows.push({ asset: asset.key, time, pair: pair.candles.symbol, ...heat });
    } catch (err) {
      console.warn(`signals: ${asset.key} skipped: ${errorText(err)}`);
    }
  }
  saveSignals(db, rows);
  savePriceChanges(db, moves);
  return rows;
}
