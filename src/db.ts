import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseAddress, WALLET_KINDS, type WalletKind } from './address.ts';
import type { Heat } from './heat.ts';
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
  `CREATE TABLE signals (
     asset      TEXT NOT NULL,
     time       TEXT NOT NULL,
     pair       TEXT NOT NULL,
     score      REAL NOT NULL,
     zone       TEXT NOT NULL,
     components TEXT NOT NULL,
     PRIMARY KEY (asset, time)
   );`,
  `CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL
   );`,
  `CREATE TABLE settings (
     key   TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
  `CREATE TABLE logos (
     kind       TEXT NOT NULL,
     key        TEXT NOT NULL,
     name       TEXT,
     source_url TEXT,
     file       TEXT,
     media_type TEXT,
     tried_at   TEXT,
     PRIMARY KEY (kind, key)
   );`,
  // 8: categories from outside assets.json: chosen by hand, or looked up from a coin's tags.
  `CREATE TABLE asset_categories (
     key       TEXT PRIMARY KEY,
     manual    TEXT,
     auto      TEXT,
     source_id TEXT,
     tags      TEXT,
     tried_at  TEXT
   );`,
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

export function renameWallet(db: DatabaseSync, id: number, label: string): boolean {
  const placeholders = WALLET_KINDS.map(() => '?').join(', ');
  return (
    db
      .prepare(`UPDATE accounts SET label = ? WHERE id = ? AND kind IN (${placeholders})`)
      .run(label, id, ...WALLET_KINDS).changes > 0
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

/**
 * Per account: the holdings of its latest successful collection, plus the status of its latest attempt.
 * `upToSnapshot` reads the portfolio as it stood at an earlier snapshot.
 */
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
    `SELECT chain, protocol, symbol, type, quantity, price, value_usd AS value
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

/** The latest finished snapshot started at or before the given time, if any. */
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

/** Every account's result in every snapshot, summed per symbol: the raw material for the history chart. */
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

// ── Signals ──────────────────────────────────────────────────────────────────

export interface SignalRow extends Heat {
  asset: string;
  time: string;
  /** Binance market the candles came from. */
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

/** The most recent signal of every asset. */
export function latestSignals(db: DatabaseSync): SignalRow[] {
  const rows = db
    .prepare(
      `SELECT asset, time, pair, score, zone, components FROM signals s
        WHERE time = (SELECT MAX(time) FROM signals WHERE asset = s.asset)`,
    )
    .all() as unknown as (Omit<SignalRow, 'components'> & { components: string })[];
  return rows.map((r) => ({ ...r, components: JSON.parse(r.components) as SignalRow['components'] }));
}

// ── Sessions ─────────────────────────────────────────────────────────────────
// Only a hash of the token is stored, so a copy of the database cannot be used to sign in.

const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

export function createSession(db: DatabaseSync, lifetimeMs: number, now = Date.now()): string {
  const token = randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date(now).toISOString());
  db.prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)').run(
    tokenHash(token),
    new Date(now).toISOString(),
    new Date(now + lifetimeMs).toISOString(),
  );
  return token;
}

export function sessionValid(db: DatabaseSync, token: string, now = Date.now()): boolean {
  const row = db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(tokenHash(token)) as
    { expires_at: string } | undefined;
  return row !== undefined && Date.parse(row.expires_at) > now;
}

export function deleteSession(db: DatabaseSync, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}

// ── Account ──────────────────────────────────────────────────────────────────
// One owner. The account is created in the browser on first run and lives in the database,
// so it travels with the data and is covered by the backups.

export interface Owner {
  passwordHash: string;
  totpSecret: string;
}

export function getOwner(db: DatabaseSync): Owner | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'owner'").get() as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as Owner) : null;
}

export function saveOwner(db: DatabaseSync, owner: Owner): void {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('owner', ?)").run(JSON.stringify(owner));
}

/** Removes the account and signs everyone out; the next start asks for setup again. */
export function deleteOwner(db: DatabaseSync): boolean {
  db.prepare('DELETE FROM sessions').run();
  return db.prepare("DELETE FROM settings WHERE key = 'owner'").run().changes > 0;
}

// ── Backup ───────────────────────────────────────────────────────────────────

/**
 * Writes today's copy of the database next to it (backups/stashboard-YYYY-MM-DD.db) unless it exists,
 * and keeps the newest `keep` copies. Returns the file written, or null if today's copy was already there.
 */
export function backupDaily(
  db: DatabaseSync,
  dir = process.env.DATA_DIR ?? 'data',
  keep = 14,
  now = new Date(),
): string | null {
  const folder = join(dir, 'backups');
  mkdirSync(folder, { recursive: true });
  const file = join(folder, `stashboard-${now.toISOString().slice(0, 10)}.db`);
  const existing = readdirSync(folder)
    .filter((f) => /^stashboard-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort();
  if (existing.includes(file.slice(folder.length + 1))) return null;
  // VACUUM INTO takes a consistent copy while the database is in use.
  db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  for (const old of existing.slice(0, Math.max(0, existing.length + 1 - keep))) rmSync(join(folder, old));
  return file;
}
