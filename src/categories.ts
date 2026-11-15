// Categories for assets that assets.json does not mention. CoinGecko tags every coin; the tags are mapped
// onto the dashboard's own categories and remembered. A category chosen by hand on the page wins over both.
import { setTimeout as sleep } from 'node:timers/promises';
import type { DatabaseSync } from 'node:sqlite';
import { OTHER_CATEGORY, STOCKS_CATEGORY, type Asset, type AssetRules, type Learned } from './assets.ts';
import type { Config } from './config.ts';
import { currentState } from './db.ts';
import { getJson, HttpError } from './http.ts';

const API = 'https://api.coingecko.com/api/v3';
// The free key allows about 30 calls a minute; categories are not urgent.
const PAUSE_MS = 2500;
const RETRY_MS = 24 * 60 * 60 * 1000;
const MIN_VALUE_USD = 1;
const MAX_PER_RUN = 25;

// First match wins, so the more specific reading comes first: a meme coin on a layer 2 is a meme coin.
const RULES: [category: string, test: (tag: string) => boolean][] = [
  ['Memes', (t) => t !== 'IP Meme' && /(^| )meme$/i.test(t)],
  ['Stablecoins', (t) => /stablecoin/i.test(t)],
  [STOCKS_CATEGORY, (t) => /tokenized stock/i.test(t)],
  ['L2', (t) => /layer 2|rollup/i.test(t)],
  ['L1', (t) => /layer 1/i.test(t)],
  [
    'DeFi',
    (t) =>
      /\b(decentralized finance|defi|exchange|dex|lending|derivatives|perpetuals?|staking|restaking|yield|launchpad|interoperability|cross-chain|bridge|oracle|marketplace|rwa|real world assets)\b/i.test(
        t,
      ),
  ],
  // A chain's own coin that is not tagged as a layer 1 or 2 outright.
  ['L1', (t) => t === 'Smart Contract Platform'],
];

/** The dashboard category for a coin's CoinGecko tags, or null when none of them says enough. */
export function categoryFromTags(tags: string[], known: string[]): string | null {
  for (const [category, test] of RULES) {
    if (known.includes(category) && tags.some(test)) return category;
  }
  return null;
}

/** Every category an asset can be given, in the order the page lists them. */
export const categoryNames = (rules: AssetRules): string[] => [
  ...new Set([...Object.keys(rules.categories), STOCKS_CATEGORY, OTHER_CATEGORY]),
];

/** Fills the resolver's memory from the database. The same object is updated in place, so the resolver sees it. */
export function loadLearned(db: DatabaseSync, into: Learned = { manual: new Map(), auto: new Map() }): Learned {
  into.manual.clear();
  into.auto.clear();
  const rows = db.prepare('SELECT key, manual, auto FROM asset_categories').all() as unknown as {
    key: string;
    manual: string | null;
    auto: string | null;
  }[];
  for (const r of rows) {
    if (r.manual) into.manual.set(r.key, r.manual);
    if (r.auto) into.auto.set(r.key, r.auto);
  }
  return into;
}

/** Sets the category chosen by hand, or clears it with null so the automatic one applies again. */
export function setManualCategory(db: DatabaseSync, key: string, category: string | null): void {
  db.prepare(
    `INSERT INTO asset_categories (key, manual) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET manual = excluded.manual`,
  ).run(key, category);
}

interface MarketRow {
  id: string;
  symbol: string;
  market_cap: number | null;
}

/**
 * Looks up assets that are still uncategorised. Several coins can share a ticker; the largest one is taken,
 * which is right for anything worth holding and can be corrected by hand when it is not.
 * Returns how many assets got a category.
 */
export async function fetchMissingCategories(
  db: DatabaseSync,
  config: Config,
  resolve: (symbol: string) => Asset,
  known: string[],
  now = Date.now(),
  pauseMs = PAUSE_MS,
): Promise<number> {
  const tried = new Map(
    (
      db.prepare('SELECT key, tried_at FROM asset_categories').all() as unknown as {
        key: string;
        tried_at: string | null;
      }[]
    ).map((r) => [r.key, r.tried_at]),
  );
  const values = new Map<string, number>();
  for (const { holdings } of currentState(db)) {
    for (const h of holdings) {
      const asset = resolve(h.symbol);
      if (asset.category === OTHER_CATEGORY) values.set(asset.key, (values.get(asset.key) ?? 0) + h.value);
    }
  }
  const due = [...values]
    .filter(([key, value]) => {
      const at = tried.get(key);
      return Math.abs(value) >= MIN_VALUE_USD && (!at || now - Date.parse(at) > RETRY_MS);
    })
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, MAX_PER_RUN)
    .map(([key]) => key);
  if (due.length === 0) return 0;

  const headers: Record<string, string> = config.coingecko.apiKey
    ? { 'x-cg-demo-api-key': config.coingecko.apiKey }
    : {};
  const symbols = due.map((k) => k.toLowerCase());
  const rows = await getJson<MarketRow[]>(
    `${API}/coins/markets?vs_currency=usd&include_tokens=all&per_page=250&symbols=${encodeURIComponent(symbols.join(','))}`,
    headers,
  );
  const largest = new Map<string, MarketRow>();
  for (const r of rows) {
    const best = largest.get(r.symbol.toLowerCase());
    if (!best || (r.market_cap ?? 0) > (best.market_cap ?? 0)) largest.set(r.symbol.toLowerCase(), r);
  }

  const save = db.prepare(
    `INSERT INTO asset_categories (key, auto, source_id, tags, tried_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET auto = excluded.auto, source_id = excluded.source_id,
       tags = excluded.tags, tried_at = excluded.tried_at`,
  );
  let found = 0;
  for (const key of due) {
    const coin = largest.get(key.toLowerCase());
    let tags: string[] = [];
    if (coin) {
      await sleep(pauseMs);
      try {
        const detail = await getJson<{ categories?: (string | null)[] }>(
          `${API}/coins/${encodeURIComponent(coin.id)}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`,
          headers,
        );
        tags = (detail.categories ?? []).filter((t): t is string => typeof t === 'string');
      } catch (err) {
        // Out of calls for now: stop and leave the rest for the next run.
        if (err instanceof HttpError && err.status === 429) break;
        if (!(err instanceof HttpError)) throw err;
      }
    }
    const category = categoryFromTags(tags, known);
    save.run(key, category, coin?.id ?? null, JSON.stringify(tags), new Date(now).toISOString());
    if (category) found++;
  }
  return found;
}
