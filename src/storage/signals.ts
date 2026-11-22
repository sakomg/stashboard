import type { DatabaseSync } from 'node:sqlite';
import type { Heat } from '../domain/heat.ts';
import type { PricePoint } from '../domain/indicators.ts';
import type { ContractHint } from '../domain/types.ts';

export interface SignalRow extends Heat {
  asset: string;
  time: string;
  pair: string;
}

export function saveSignals(db: DatabaseSync, rows: SignalRow[]): void {
  const insert = db.prepare(
    'INSERT OR REPLACE INTO signals (asset, time, pair, score, zone, components) VALUES (?, ?, ?, ?, ?, ?)',
  );
  db.exec('BEGIN');
  try {
    for (const r of rows) insert.run(r.asset, r.time, r.pair, r.score, r.zone, JSON.stringify(r.components));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function latestSignals(db: DatabaseSync): SignalRow[] {
  const rows = db
    .prepare(
      `SELECT asset, time, pair, score, zone, components FROM signals s
        WHERE time = (SELECT MAX(time) FROM signals WHERE asset = s.asset)`,
    )
    .all() as unknown as (Omit<SignalRow, 'components'> & { components: string })[];
  return rows.map((r) => ({ ...r, components: JSON.parse(r.components) as SignalRow['components'] }));
}

type Extreme = 'overheated' | 'cold';

const ENDED_BY: Record<Extreme, [string, string]> = { overheated: ['cold', 'neutral'], cold: ['warm', 'overheated'] };

export function extremeSince(db: DatabaseSync, zone: Extreme): Map<string, string> {
  const rows = db
    .prepare(
      `SELECT asset, MIN(time) AS since FROM signals s
        WHERE zone = ?
          AND time > COALESCE(
            (SELECT MAX(time) FROM signals c WHERE c.asset = s.asset AND c.zone IN (?, ?)),
            ''
          )
        GROUP BY asset`,
    )
    .all(zone, ...ENDED_BY[zone]) as { asset: string; since: string }[];
  return new Map(rows.map((r) => [r.asset, r.since]));
}

export const isExtreme = (zone: string): zone is Extreme => zone === 'overheated' || zone === 'cold';

export function heatSeen(db: DatabaseSync, userId: number): Map<string, string> {
  const rows = db.prepare('SELECT asset, since FROM heat_seen WHERE user_id = ?').all(userId) as {
    asset: string;
    since: string;
  }[];
  return new Map(rows.map((r) => [r.asset, r.since]));
}

export function markHeatSeen(db: DatabaseSync, userId: number, assets: string[]): string[] {
  const since = { overheated: extremeSince(db, 'overheated'), cold: extremeSince(db, 'cold') };
  const episodes = new Map<string, string>();
  for (const s of latestSignals(db)) {
    const start = isExtreme(s.zone) ? since[s.zone].get(s.asset) : undefined;
    if (start) episodes.set(s.asset, start);
  }
  const upsert = db.prepare('INSERT OR REPLACE INTO heat_seen (user_id, asset, since) VALUES (?, ?, ?)');
  const marked = assets.filter((a) => episodes.has(a));
  for (const asset of marked) upsert.run(userId, asset, episodes.get(asset)!);
  return marked;
}

export interface PriceChange {
  asset: string;
  time: string;
  d1: number | null;
  d7: number | null;
  d30: number | null;
}

export function savePriceChanges(db: DatabaseSync, rows: PriceChange[]): void {
  const upsert = db.prepare('INSERT OR REPLACE INTO price_changes (asset, time, d1, d7, d30) VALUES (?, ?, ?, ?, ?)');
  db.exec('BEGIN');
  try {
    for (const r of rows) upsert.run(r.asset, r.time, r.d1, r.d7, r.d30);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function noteContracts(db: DatabaseSync, hints: ContractHint[]): void {
  const upsert = db.prepare('INSERT OR REPLACE INTO token_contracts (symbol, chain, address) VALUES (?, ?, ?)');
  for (const h of hints) upsert.run(h.symbol, h.chain, h.address);
}

export function tokenContracts(db: DatabaseSync): Map<string, string> {
  const rows = db.prepare('SELECT symbol, chain, address FROM token_contracts').all() as unknown as ContractHint[];
  return new Map(rows.map((r) => [contractKey(r.chain, r.symbol), r.address]));
}

export const contractKey = (chain: string, symbol: string): string => `${chain}\n${symbol}`;

interface PriceHistory {
  points: PricePoint[] | null;
  fetchedAt: string;
}

export function priceHistories(db: DatabaseSync): Map<string, PriceHistory> {
  const rows = db.prepare('SELECT asset, points, fetched_at FROM price_histories').all() as {
    asset: string;
    points: string | null;
    fetched_at: string;
  }[];
  return new Map(
    rows.map((r) => [
      r.asset,
      { points: r.points === null ? null : (JSON.parse(r.points) as PricePoint[]), fetchedAt: r.fetched_at },
    ]),
  );
}

export function savePriceHistory(db: DatabaseSync, asset: string, points: PricePoint[] | null, at: string): void {
  db.prepare('INSERT OR REPLACE INTO price_histories (asset, points, fetched_at) VALUES (?, ?, ?)').run(
    asset,
    points === null ? null : JSON.stringify(points),
    at,
  );
}

export function priceChangesSince(db: DatabaseSync, since: string): Map<string, PriceChange> {
  const rows = db
    .prepare('SELECT asset, time, d1, d7, d30 FROM price_changes WHERE time >= ?')
    .all(since) as unknown as PriceChange[];
  return new Map(rows.map((r) => [r.asset, r]));
}
