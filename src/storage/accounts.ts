import type { DatabaseSync } from 'node:sqlite';
import { parseAddress, WALLET_KINDS, type WalletKind } from '../domain/address.ts';
import type { Account, Wallet } from '../domain/types.ts';

export type { Account, AccountKind, Wallet } from '../domain/types.ts';

export type Owner = number | 'all';

export function listAccounts(db: DatabaseSync, owner: Owner): Account[] {
  const columns = 'SELECT id, kind, label, address FROM accounts';
  return (owner === 'all'
    ? db.prepare(`${columns} ORDER BY id`).all()
    : db.prepare(`${columns} WHERE user_id = ? ORDER BY id`).all(owner)) as unknown as Account[];
}

export function listWallets(db: DatabaseSync, owner: Owner, kind?: WalletKind): Wallet[] {
  const kinds: readonly string[] = kind ? [kind] : WALLET_KINDS;
  return listAccounts(db, owner).filter((a): a is Wallet => kinds.includes(a.kind));
}

export function addWallet(db: DatabaseSync, userId: number, input: string, label?: string): Wallet {
  const parsed = parseAddress(input);
  const existing = db
    .prepare('SELECT id, label FROM accounts WHERE user_id = ? AND kind = ? AND address_key = ?')
    .get(userId, parsed.kind, parsed.key) as { id: number; label: string } | undefined;
  if (existing) throw new Error(`This ${parsed.kind} wallet is already added: #${existing.id} "${existing.label}"`);

  const count = (
    db.prepare('SELECT COUNT(*) AS n FROM accounts WHERE user_id = ? AND kind = ?').get(userId, parsed.kind) as {
      n: number;
    }
  ).n;
  const finalLabel = label?.trim() || `${parsed.kind}-${count + 1}`;
  const { lastInsertRowid } = db
    .prepare('INSERT INTO accounts (user_id, kind, label, address, address_key) VALUES (?, ?, ?, ?, ?)')
    .run(userId, parsed.kind, finalLabel, parsed.address, parsed.key);
  return { id: Number(lastInsertRowid), kind: parsed.kind, label: finalLabel, address: parsed.address };
}

export function removeAccount(db: DatabaseSync, userId: number, id: number): boolean {
  return db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

export function renameAccount(db: DatabaseSync, userId: number, id: number, label: string): boolean {
  return db.prepare('UPDATE accounts SET label = ? WHERE id = ? AND user_id = ?').run(label, id, userId).changes > 0;
}
