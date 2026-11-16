import { setTimeout as sleep } from 'node:timers/promises';
import type { DatabaseSync } from 'node:sqlite';
import { OTHER_CATEGORY, STOCKS_CATEGORY, type Asset, type AssetRules, type Learned } from '../domain/assets.ts';
import type { Config } from '../lib/config.ts';
import { currentState } from '../storage/index.ts';
import { getJson, HttpError } from '../lib/http.ts';

const API = 'https://api.coingecko.com/api/v3';
const PAUSE_MS = 2500;
const RETRY_MS = 24 * 60 * 60 * 1000;
const MIN_VALUE_USD = 1;
const MAX_PER_RUN = 25;

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
  ['L1', (t) => t === 'Smart Contract Platform'],
];

export function categoryFromTags(tags: string[], known: string[]): string | null {
  for (const [category, test] of RULES) {
    if (known.includes(category) && tags.some(test)) return category;
  }
  return null;
}

export const categoryNames = (rules: AssetRules): string[] => [
  ...new Set([...Object.keys(rules.categories), STOCKS_CATEGORY, OTHER_CATEGORY]),
];

export function loadLearned(db: DatabaseSync, into: Learned = { manual: new Map(), auto: new Map() }): Learned {
  into.auto.clear();
  const rows = db.prepare('SELECT key, auto FROM asset_categories WHERE auto IS NOT NULL').all() as unknown as {
    key: string;
    auto: string;
  }[];
  for (const r of rows) into.auto.set(r.key, r.auto);
  return into;
}

export function manualCategories(db: DatabaseSync, userId: number): Map<string, string> {
  const rows = db.prepare('SELECT key, category FROM user_categories WHERE user_id = ?').all(userId) as unknown as {
    key: string;
    category: string;
  }[];
  return new Map(rows.map((r) => [r.key, r.category]));
}

export function setManualCategory(db: DatabaseSync, userId: number, key: string, category: string | null): void {
  if (category === null) {
    db.prepare('DELETE FROM user_categories WHERE user_id = ? AND key = ?').run(userId, key);
    return;
  }
  db.prepare(
    `INSERT INTO user_categories (user_id, key, category) VALUES (?, ?, ?)
     ON CONFLICT (user_id, key) DO UPDATE SET category = excluded.category`,
  ).run(userId, key, category);
}

interface MarketRow {
  id: string;
  symbol: string;
  market_cap: number | null;
}

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
  for (const { holdings } of currentState(db, 'all')) {
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
