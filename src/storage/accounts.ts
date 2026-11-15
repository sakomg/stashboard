import type { DatabaseSync } from 'node:sqlite';
import { parseAddress, WALLET_KINDS, type WalletKind } from '../domain/address.ts';
import type { Account, Wallet } from '../domain/types.ts';

export type { Account, AccountKind, Wallet } from '../domain/types.ts';

export function listAccounts(db: DatabaseSync): Account[] {
  return db.prepare('SELECT id, kind, label, address FROM accounts ORDER BY id').all() as unknown as Account[];
}

export function listWallets(db: DatabaseSync, kind?: WalletKind): Wallet[] {
  const kinds: readonly string[] = kind ? [kind] : WALLET_KINDS;
  return listAccounts(db).filter((a): a is Wallet => kinds.includes(a.kind));
}

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

export function removeAccount(db: DatabaseSync, id: number): boolean {
  return db.prepare('DELETE FROM accounts WHERE id = ?').run(id).changes > 0;
}

export function renameAccount(db: DatabaseSync, id: number, label: string): boolean {
  return db.prepare('UPDATE accounts SET label = ? WHERE id = ?').run(label, id).changes > 0;
}
