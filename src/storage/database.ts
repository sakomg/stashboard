import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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
  `CREATE TABLE asset_categories (
     key       TEXT PRIMARY KEY,
     manual    TEXT,
     auto      TEXT,
     source_id TEXT,
     tags      TEXT,
     tried_at  TEXT
   );`,
  `CREATE TABLE zerion_cache (
     address    TEXT NOT NULL,
     part       TEXT NOT NULL,
     fetched_at TEXT NOT NULL,
     positions  TEXT NOT NULL,
     PRIMARY KEY (address, part)
   );
   ALTER TABLE holdings ADD COLUMN read_at TEXT;`,
  `CREATE TABLE shares (
     token      TEXT PRIMARY KEY,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     payload    TEXT NOT NULL
   );`,
  `CREATE TABLE exchange_keys (
     account_id INTEGER PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
     key_hint   TEXT NOT NULL,
     sealed     TEXT NOT NULL
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
