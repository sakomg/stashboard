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
