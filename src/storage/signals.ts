import type { DatabaseSync } from 'node:sqlite';
import type { Heat } from '../domain/heat.ts';

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

export interface PriceChange {
  asset: string;
  time: string;
  d7: number | null;
  d30: number | null;
}

export function savePriceChanges(db: DatabaseSync, rows: PriceChange[]): void {
  const upsert = db.prepare('INSERT OR REPLACE INTO price_changes (asset, time, d7, d30) VALUES (?, ?, ?, ?)');
  db.exec('BEGIN');
  try {
    for (const r of rows) upsert.run(r.asset, r.time, r.d7, r.d30);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function priceChangesSince(db: DatabaseSync, since: string): Map<string, PriceChange> {
  const rows = db
    .prepare('SELECT asset, time, d7, d30 FROM price_changes WHERE time >= ?')
    .all(since) as unknown as PriceChange[];
  return new Map(rows.map((r) => [r.asset, r]));
}
