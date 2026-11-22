import { setTimeout as sleep } from 'node:timers/promises';
import type { DatabaseSync } from 'node:sqlite';
import { errorText } from '../lib/errors.ts';
import { STABLECOINS_CATEGORY, STOCKS_CATEGORY, type Asset } from '../domain/assets.ts';
import type { Config } from '../lib/config.ts';
import {
  contractKey,
  currentState,
  priceHistories,
  savePriceChanges,
  savePriceHistory,
  saveSignals,
  tokenContracts,
  type AccountState,
  type PriceChange,
  type SignalRow,
} from '../storage/index.ts';
import { heatScore, type Readings } from '../domain/heat.ts';
import { priceChange, rsi, sma, weeklyCloses, type PricePoint } from '../domain/indicators.ts';
import { buildPortfolio } from '../domain/portfolio.ts';
import { coingeckoPlatform, dailyCloses } from '../sources/coingecko.ts';
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
const COINGECKO_PAUSE_MS = 2500;
const COINGECKO_MIN_READINGS = 2;
const HISTORY_EVERY_MS = 24 * 60 * 60 * 1000;

interface Candles {
  market: 'spot' | 'futures';
  symbol: string;
}

interface Pair {
  candles: Candles | null;
  perp: string | null;
}

interface Contract {
  platform: string;
  address: string;
}

interface Read {
  pair: string;
  daily: number[];
  d1: number | null;
  readings: Readings;
  minReadings: number;
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

function priceReadings(daily: number[], weekly: number[]): Readings {
  const average = sma(daily, 200);
  const last = daily.at(-1);
  return {
    rsiDaily: rsi(daily),
    rsiWeekly: rsi(weekly),
    funding: null,
    ma200: average && last ? (last / average - 1) * 100 : null,
    oiGrowth: null,
  };
}

async function readBinance({ market, symbol }: Candles, perp: string | null): Promise<Read> {
  const daily = await closes(market, symbol, '1d', 300);
  const d1 = await change24h(market, symbol);
  const readings = priceReadings(daily, await closes(market, symbol, '1w', 150));
  if (perp) {
    readings.funding = await funding8hPct(perp);
    const growth = await openInterestChange7dPct(perp);
    const last = daily.at(-1);
    const weekAgo = daily.at(-8);
    if (growth !== null && last && weekAgo) readings.oiGrowth = last > weekAgo ? growth : 0;
  }
  return { pair: symbol, daily, d1, readings, minReadings: 1 };
}

function readHistory(points: PricePoint[], price: number | null, now: number): Read {
  const series: PricePoint[] = price !== null && price > 0 ? [...points, [now, price]] : points;
  const daily = series.map(([, close]) => close);
  const readings = priceReadings(daily, weeklyCloses(series));
  return { pair: 'CoinGecko', daily, d1: null, readings, minReadings: COINGECKO_MIN_READINGS };
}

const scorable = (asset: { value: number; category: string }): boolean =>
  Math.abs(asset.value) >= MIN_VALUE_USD && !NO_SIGNALS.has(asset.category);

function contractsByAsset(
  states: AccountState[],
  known: Map<string, string>,
  resolve: (symbol: string) => Asset,
): Map<string, Contract[]> {
  const held = new Map<string, Contract & { asset: string; value: number }>();
  for (const h of states.flatMap((s) => s.holdings)) {
    const address = known.get(contractKey(h.chain, h.symbol));
    const platform = coingeckoPlatform(h.chain);
    if (!address || !platform) continue;
    const id = `${platform}\n${address}`;
    const entry = held.get(id) ?? { asset: resolve(h.symbol).key, platform, address, value: 0 };
    entry.value += Math.abs(h.value);
    held.set(id, entry);
  }
  const byAsset = new Map<string, Contract[]>();
  for (const c of [...held.values()].sort((a, b) => b.value - a.value)) {
    byAsset.set(c.asset, [...(byAsset.get(c.asset) ?? []), { platform: c.platform, address: c.address }]);
  }
  return byAsset;
}

export async function refreshPriceHistories(
  db: DatabaseSync,
  config: Config,
  resolve: (symbol: string) => Asset,
  everyMs: number,
  now = Date.now(),
  pauseMs = COINGECKO_PAUSE_MS,
): Promise<void> {
  const states = currentState(db, 'all');
  const contracts = contractsByAsset(states, tokenContracts(db), resolve);
  if (contracts.size === 0) return;
  const markets = await listMarkets();
  const fetchedAt = new Map([...priceHistories(db)].map(([asset, history]) => [asset, history.fetchedAt]));
  const wanted = buildPortfolio(states, resolve).assets.filter(
    (a) => scorable(a) && contracts.has(a.key) && !findPair(a, markets).candles,
  );
  const due = wanted
    .filter((a) => !fetchedAt.has(a.key) || now - Date.parse(fetchedAt.get(a.key)!) >= HISTORY_EVERY_MS)
    .sort((a, b) => (fetchedAt.get(a.key) ?? '').localeCompare(fetchedAt.get(b.key) ?? ''))
    .slice(0, Math.ceil((wanted.length * everyMs) / HISTORY_EVERY_MS));

  let asked = false;
  for (const asset of due) {
    let points: PricePoint[] | null = null;
    for (const { platform, address } of contracts.get(asset.key) ?? []) {
      if (asked) await sleep(pauseMs);
      asked = true;
      points = await dailyCloses(config.coingecko.apiKey, platform, address);
      if (points?.length) break;
    }
    savePriceHistory(db, asset.key, points?.length ? points : null, new Date(now).toISOString());
  }
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
  const histories = priceHistories(db);
  const now = Date.now();
  const time = new Date(now).toISOString();
  const rows: SignalRow[] = [];
  const moves: PriceChange[] = [];

  for (const asset of assets) {
    if (!scorable(asset)) continue;
    const pair = findPair(asset, markets);
    const points = histories.get(asset.key)?.points;
    try {
      const read = pair.candles
        ? await readBinance(pair.candles, pair.perp)
        : points?.length
          ? readHistory(points, asset.price, now)
          : null;
      if (!read) continue;
      const { daily } = read;
      moves.push({ asset: asset.key, time, d1: read.d1, d7: priceChange(daily, 7), d30: priceChange(daily, 30) });
      const known = Object.values(read.readings).filter((v) => v !== null).length;
      const heat = known >= read.minReadings ? heatScore(read.readings, config.heat) : null;
      if (heat) rows.push({ asset: asset.key, time, pair: read.pair, ...heat });
    } catch (err) {
      console.warn(`signals: ${asset.key} skipped: ${errorText(err)}`);
    }
  }
  saveSignals(db, rows);
  savePriceChanges(db, moves);
  return rows;
}
