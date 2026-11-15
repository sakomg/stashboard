import type { DatabaseSync } from 'node:sqlite';
import type { AccountState, Holding, HoldingType } from '../domain/types.ts';
import { listAccounts } from './accounts.ts';

export type { AccountState } from '../domain/types.ts';

export type AccountOutcome =
  | { status: 'ok'; holdings: Holding[]; warnings: string[]; reportedTotal?: number }
  | { status: 'error'; error: string };

export function startSnapshot(db: DatabaseSync): number {
  return Number(
    db.prepare('INSERT INTO snapshots (started_at) VALUES (?)').run(new Date().toISOString()).lastInsertRowid,
  );
}

export function saveOutcome(db: DatabaseSync, snapshotId: number, accountId: number, outcome: AccountOutcome): void {
  db.exec('BEGIN');
  try {
    if (outcome.status === 'error') {
      db.prepare('INSERT INTO snapshot_accounts (snapshot_id, account_id, status, error) VALUES (?, ?, ?, ?)').run(
        snapshotId,
        accountId,
        'error',
        outcome.error,
      );
    } else {
      db.prepare(
        'INSERT INTO snapshot_accounts (snapshot_id, account_id, status, warnings, reported_total) VALUES (?, ?, ?, ?, ?)',
      ).run(snapshotId, accountId, 'ok', JSON.stringify(outcome.warnings), outcome.reportedTotal ?? null);
      const insert = db.prepare(
        `INSERT INTO holdings (snapshot_id, account_id, chain, protocol, symbol, type, quantity, price, value_usd, read_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const h of outcome.holdings) {
        insert.run(
          snapshotId,
          accountId,
          h.chain,
          h.protocol,
          h.symbol,
          h.type,
          h.quantity,
          h.price,
          h.value,
          h.readAt ?? null,
        );
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function finishSnapshot(db: DatabaseSync, snapshotId: number): void {
  db.prepare('UPDATE snapshots SET finished_at = ? WHERE id = ?').run(new Date().toISOString(), snapshotId);
}

export function currentState(db: DatabaseSync, upToSnapshot = Number.MAX_SAFE_INTEGER): AccountState[] {
  const lastAttempt = db.prepare(
    'SELECT snapshot_id, status, error FROM snapshot_accounts WHERE account_id = ? AND snapshot_id <= ? ORDER BY snapshot_id DESC LIMIT 1',
  );
  const lastOk = db.prepare(
    `SELECT sa.snapshot_id, sa.warnings, sa.reported_total, s.started_at
       FROM snapshot_accounts sa JOIN snapshots s ON s.id = sa.snapshot_id
      WHERE sa.account_id = ? AND sa.status = 'ok' AND sa.snapshot_id <= ?
      ORDER BY sa.snapshot_id DESC LIMIT 1`,
  );
  const holdingsOf = db.prepare(
    `SELECT chain, protocol, symbol, type, quantity, price, value_usd AS value, read_at AS readAt
       FROM holdings WHERE snapshot_id = ? AND account_id = ? ORDER BY value_usd DESC`,
  );

  return listAccounts(db).map((account) => {
    const attempt = lastAttempt.get(account.id, upToSnapshot) as
      { snapshot_id: number; status: 'ok' | 'error'; error: string | null } | undefined;
    const ok = lastOk.get(account.id, upToSnapshot) as
      { snapshot_id: number; warnings: string | null; reported_total: number | null; started_at: string } | undefined;
    const rows = ok
      ? (holdingsOf.all(ok.snapshot_id, account.id) as unknown as (Holding & { type: HoldingType })[])
      : [];
    return {
      account,
      lastStatus: attempt?.status ?? null,
      lastError: attempt?.error ?? null,
      collectedAt: ok?.started_at ?? null,
      stale: attempt?.status === 'error',
      warnings: ok?.warnings ? (JSON.parse(ok.warnings) as string[]) : [],
      reportedTotal: ok?.reported_total ?? null,
      holdings: rows.map((r) => ({ ...r })),
    };
  });
}

export interface SnapshotInfo {
  id: number;
  startedAt: string;
}

export function listSnapshots(db: DatabaseSync): SnapshotInfo[] {
  return db
    .prepare('SELECT id, started_at AS startedAt FROM snapshots WHERE finished_at IS NOT NULL ORDER BY id')
    .all() as unknown as SnapshotInfo[];
}

export function snapshotAt(db: DatabaseSync, time: Date): SnapshotInfo | undefined {
  return db
    .prepare(
      'SELECT id, started_at AS startedAt FROM snapshots WHERE finished_at IS NOT NULL AND started_at <= ? ORDER BY id DESC LIMIT 1',
    )
    .get(time.toISOString()) as unknown as SnapshotInfo | undefined;
}

export interface SnapshotValue {
  snapshotId: number;
  accountId: number;
  status: 'ok' | 'error';
  symbol: string | null;
  value: number | null;
}

export function snapshotValues(db: DatabaseSync): SnapshotValue[] {
  return db
    .prepare(
      `SELECT sa.snapshot_id AS snapshotId, sa.account_id AS accountId, sa.status, h.symbol, SUM(h.value_usd) AS value
         FROM snapshot_accounts sa
         LEFT JOIN holdings h ON h.snapshot_id = sa.snapshot_id AND h.account_id = sa.account_id
        GROUP BY sa.snapshot_id, sa.account_id, h.symbol
        ORDER BY sa.snapshot_id`,
    )
    .all() as unknown as SnapshotValue[];
}

export function resetHistory(db: DatabaseSync): number {
  const from = db
    .prepare(
      `SELECT MIN(last_ok) AS id FROM (
         SELECT MAX(snapshot_id) AS last_ok FROM snapshot_accounts WHERE status = 'ok' GROUP BY account_id
       )`,
    )
    .get() as { id: number | null };
  if (from.id === null) return 0;
  return Number(db.prepare('DELETE FROM snapshots WHERE id < ?').run(from.id).changes);
}
