import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseAddress, type WalletKind } from './address.ts';

export interface Wallet {
  id: number;
  kind: WalletKind;
  label: string;
  address: string;
}

export function openDb(dir = process.env.DATA_DIR ?? 'data'): DatabaseSync {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(join(dir, 'stashboard.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS accounts (
      id          INTEGER PRIMARY KEY,
      kind        TEXT NOT NULL,
      label       TEXT NOT NULL,
      address     TEXT NOT NULL,
      address_key TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (kind, address_key)
    );
  `);
  return db;
}

export function listWallets(db: DatabaseSync, kind?: WalletKind): Wallet[] {
  const rows = kind
    ? db.prepare('SELECT id, kind, label, address FROM accounts WHERE kind = ? ORDER BY id').all(kind)
    : db.prepare('SELECT id, kind, label, address FROM accounts ORDER BY kind, id').all();
  return rows as unknown as Wallet[];
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

export function removeWallet(db: DatabaseSync, id: number): boolean {
  return db.prepare('DELETE FROM accounts WHERE id = ?').run(id).changes > 0;
}
