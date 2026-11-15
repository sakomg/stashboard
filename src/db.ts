import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseAddress, WALLET_KINDS, type WalletKind } from './address.ts';
import type { Holding, HoldingType } from './types.ts';

export type AccountKind = WalletKind | 'binance';

export interface Account {
  id: number;
  kind: AccountKind;
  label: string;
  address: string;
}

export interface Wallet extends Account {
  kind: WalletKind;
}

// Each entry upgrades the schema by one version; PRAGMA user_version records how many have run.
const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS accounts (
     id          INTEGER PRIMARY KEY,
     kind        TEXT NOT NULL,
     label       TEXT NOT NULL,
     address     TEXT NOT NULL,
     address_key TEXT NOT NULL,
     created_at  TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (kind, address_key)
   );`,
  `CREATE TABLE snapshots (
     id          INTEGER PRIMARY KEY,
     started_at  TEXT NOT NULL,
     finished_at TEXT
   );
   CREATE TABLE snapshot_accounts (
     snapshot_id INTEGER NOT NULL REFERENCES snapshots (id) ON DELETE CASCADE,
     account_id  INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
     status      TEXT NOT NULL CHECK (status IN ('ok', 'error')),
     error       TEXT,
     warnings    TEXT,
     reported_total REAL,
     PRIMARY KEY (snapshot_id, account_id)
   );
   CREATE TABLE holdings (
     id          INTEGER PRIMARY KEY,
     snapshot_id INTEGER NOT NULL REFERENCES snapshots (id) ON DELETE CASCADE,
     account_id  INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
     chain       TEXT NOT NULL,
     protocol    TEXT,
     symbol      TEXT NOT NULL,
     type        TEXT NOT NULL,
     quantity    REAL NOT NULL,
     price       REAL,
     value_usd   REAL NOT NULL
   );
   CREATE INDEX holdings_by_snapshot ON holdings (snapshot_id, account_id);`,
];

export function openDb(dir = process.env.DATA_DIR ?? 'data'): DatabaseSync {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'stashboard.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return db;
}

// ── Accounts ─────────────────────────────────────────────────────────────────

export function listAccounts(db: DatabaseSync): Account[] {
  return db.prepare('SELECT id, kind, label, address FROM accounts ORDER BY id').all() as unknown as Account[];
}

export function listWallets(db: DatabaseSync, kind?: WalletKind): Wallet[] {
  const kinds: readonly string[] = kind ? [kind] : WALLET_KINDS;
  return listAccounts(db).filter((a): a is Wallet => kinds.includes(a.kind));
}

/** Adds a wallet; the network is detected from the address format unless given. */
export function addWallet(db: DatabaseSync, input: string, label?: string, kind?: WalletKind): Wallet {
  const parsed = parseAddress(input, kind);
  const existing = db
    .prepare('SELECT id, label FROM accounts WHERE kind = ? AND address_key = ?')
    .get(parsed.kind, parsed.key) as { id: number; label: string } | undefined;
  if (existing) throw new Error(`This ${parsed.kind} wallet is already added: #${existing.id} "${existing.label}"`);

  const count = (db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE kind = ?').get(parsed.kind) as { n: number }).n;
  const finalLabel = label?.trim() || `${parsed.kind}-${count + 1}`;
  const { lastInsertRowid } = db
    .prepare('INSERT INTO accounts (kind, label, address, address_key) VALUES (?, ?, ?, ?)')
    .run(parsed.kind, finalLabel, parsed.address, parsed.key);
  return { id: Number(lastInsertRowid), kind: parsed.kind, label: finalLabel, address: parsed.address };
}

/** Removes a wallet together with its collected history. */
export function removeWallet(db: DatabaseSync, id: number): boolean {
  const placeholders = WALLET_KINDS.map(() => '?').join(', ');
  return (
    db.prepare(`DELETE FROM accounts WHERE id = ? AND kind IN (${placeholders})`).run(id, ...WALLET_KINDS).changes > 0
  );
}

/** The exchange is an account too, so its holdings and status are stored like a wallet's. */
export function ensureExchangeAccount(db: DatabaseSync, kind: 'binance', label: string): Account {
  db.prepare('INSERT OR IGNORE INTO accounts (kind, label, address, address_key) VALUES (?, ?, ?, ?)').run(
    kind,
    label,
    '',
    kind,
  );
  return db.prepare('SELECT id, kind, label, address FROM accounts WHERE kind = ?').get(kind) as unknown as Account;
}

// ── Snapshots ────────────────────────────────────────────────────────────────

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
        `INSERT INTO holdings (snapshot_id, account_id, chain, protocol, symbol, type, quantity, price, value_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const h of outcome.holdings) {
        insert.run(snapshotId, accountId, h.chain, h.protocol, h.symbol, h.type, h.quantity, h.price, h.value);
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

// ── Reading the current portfolio ────────────────────────────────────────────

export interface AccountState {
  account: Account;
  /** Result of the most recent attempt; null if the account has never been collected. */
  lastStatus: 'ok' | 'error' | null;
  lastError: string | null;
  /** When the holdings below were collected; null if there has never been a successful run. */
  collectedAt: string | null;
  /** True when the most recent attempt failed and the holdings come from an earlier run. */
  stale: boolean;
  warnings: string[];
  reportedTotal: number | null;
  holdings: Holding[];
}

/** Per account: the holdings of its latest successful collection, plus the status of its latest attempt. */
export function currentState(db: DatabaseSync): AccountState[] {
  const lastAttempt = db.prepare(
    'SELECT snapshot_id, status, error FROM snapshot_accounts WHERE account_id = ? ORDER BY snapshot_id DESC LIMIT 1',
  );
  const lastOk = db.prepare(
    `SELECT sa.snapshot_id, sa.warnings, sa.reported_total, s.started_at
       FROM snapshot_accounts sa JOIN snapshots s ON s.id = sa.snapshot_id
      WHERE sa.account_id = ? AND sa.status = 'ok'
      ORDER BY sa.snapshot_id DESC LIMIT 1`,
  );
  const holdingsOf = db.prepare(
    `SELECT chain, protocol, symbol, type, quantity, price, value_usd AS value
       FROM holdings WHERE snapshot_id = ? AND account_id = ? ORDER BY value_usd DESC`,
  );

  return listAccounts(db).map((account) => {
    const attempt = lastAttempt.get(account.id) as
      { snapshot_id: number; status: 'ok' | 'error'; error: string | null } | undefined;
    const ok = lastOk.get(account.id) as
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
