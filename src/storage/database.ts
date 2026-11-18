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
  `CREATE TABLE users (
     id            INTEGER PRIMARY KEY,
     name          TEXT NOT NULL,
     name_key      TEXT NOT NULL UNIQUE,
     password_hash TEXT,
     totp_secret   TEXT,
     totp_step     INTEGER NOT NULL DEFAULT 0,
     admin         INTEGER NOT NULL DEFAULT 0,
     hide_amounts  INTEGER NOT NULL DEFAULT 0,
     created_at    TEXT NOT NULL DEFAULT (datetime('now'))
   );
   INSERT INTO users (id, name, name_key, password_hash, totp_secret, admin, hide_amounts)
   VALUES (
     1, 'admin', 'admin',
     (SELECT json_extract(value, '$.passwordHash') FROM settings WHERE key = 'owner'),
     (SELECT json_extract(value, '$.totpSecret') FROM settings WHERE key = 'owner'),
     1,
     COALESCE((SELECT value = '1' FROM settings WHERE key = 'hide_amounts'), 0)
   );
   DELETE FROM settings WHERE key IN ('owner', 'hide_amounts');

   CREATE TABLE invites (
     id         INTEGER PRIMARY KEY,
     token_hash TEXT NOT NULL UNIQUE,
     created_by INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL
   );

   CREATE TABLE accounts_new (
     id          INTEGER PRIMARY KEY,
     user_id     INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     kind        TEXT NOT NULL,
     label       TEXT NOT NULL,
     address     TEXT NOT NULL,
     address_key TEXT NOT NULL,
     created_at  TEXT NOT NULL DEFAULT (datetime('now')),
     UNIQUE (user_id, kind, address_key)
   );
   INSERT INTO accounts_new (id, user_id, kind, label, address, address_key, created_at)
     SELECT id, 1, kind, label, address, address_key, created_at FROM accounts;
   DROP TABLE accounts;
   ALTER TABLE accounts_new RENAME TO accounts;

   CREATE TABLE sessions_new (
     token_hash TEXT PRIMARY KEY,
     user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL
   );
   INSERT INTO sessions_new (token_hash, user_id, created_at, expires_at)
     SELECT token_hash, 1, created_at, expires_at FROM sessions;
   DROP TABLE sessions;
   ALTER TABLE sessions_new RENAME TO sessions;

   CREATE TABLE shares_new (
     token      TEXT PRIMARY KEY,
     user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL,
     payload    TEXT NOT NULL
   );
   INSERT INTO shares_new (token, user_id, created_at, expires_at, payload)
     SELECT token, 1, created_at, expires_at, payload FROM shares;
   DROP TABLE shares;
   ALTER TABLE shares_new RENAME TO shares;

   CREATE TABLE user_categories (
     user_id  INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     key      TEXT NOT NULL,
     category TEXT NOT NULL,
     PRIMARY KEY (user_id, key)
   );
   INSERT INTO user_categories (user_id, key, category)
     SELECT 1, key, manual FROM asset_categories WHERE manual IS NOT NULL;
   ALTER TABLE asset_categories DROP COLUMN manual;`,
  `DELETE FROM holdings
    WHERE lower(protocol) = 'lighter' AND protocol <> 'Lighter'
      AND EXISTS (
        SELECT 1 FROM holdings direct
         WHERE direct.snapshot_id = holdings.snapshot_id
           AND direct.account_id = holdings.account_id
           AND direct.protocol = 'Lighter'
      );`,
  `CREATE TABLE price_changes (
     asset TEXT PRIMARY KEY,
     time  TEXT NOT NULL,
     d7    REAL,
     d30   REAL
   );`,
  `ALTER TABLE invites ADD COLUMN sealed TEXT;`,
  `CREATE TABLE heat_seen (
     user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     asset   TEXT NOT NULL,
     since   TEXT NOT NULL,
     PRIMARY KEY (user_id, asset)
   );`,
  `ALTER TABLE price_changes ADD COLUMN d1 REAL;`,
  `ALTER TABLE invites ADD COLUMN for_user INTEGER REFERENCES users (id) ON DELETE CASCADE;`,
  `ALTER TABLE users ADD COLUMN on_board INTEGER NOT NULL DEFAULT 1;
   ALTER TABLE users ADD COLUMN board_key TEXT;
   CREATE UNIQUE INDEX users_board_key ON users (board_key);`,
  `ALTER TABLE users ADD COLUMN board_name TEXT;
   CREATE UNIQUE INDEX users_board_name ON users (board_name);`,
  `CREATE TABLE push_subscriptions (
     endpoint   TEXT PRIMARY KEY,
     user_id    INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     p256dh     TEXT NOT NULL,
     auth       TEXT NOT NULL,
     created_at TEXT NOT NULL
   );
   CREATE TABLE notified (
     user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
     topic   TEXT NOT NULL,
     since   TEXT NOT NULL,
     PRIMARY KEY (user_id, topic)
   );`,
];

export function migrate(db: DatabaseSync, target = MIGRATIONS.length): void {
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    const { user_version: version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
    for (let v = version; v < target; v++) {
      db.exec('BEGIN');
      try {
        db.exec(MIGRATIONS[v]!);
        const broken = db.prepare('PRAGMA foreign_key_check').all();
        if (broken.length > 0) throw new Error(`Migration ${v + 1} would leave ${broken.length} rows pointing nowhere`);
        db.exec(`PRAGMA user_version = ${v + 1}`);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

export function openDb(dir = process.env.DATA_DIR ?? 'data'): DatabaseSync {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'stashboard.db'));
  db.exec('PRAGMA journal_mode = WAL');
  migrate(db);
  return db;
}
