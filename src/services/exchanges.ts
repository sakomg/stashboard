import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { getSetting, setSetting, type Account } from '../storage/index.ts';
import { checkBinanceKey, collectBinance, pingBinance } from '../sources/binance.ts';
import { checkBybitKey, collectBybit, pingBybit } from '../sources/bybit.ts';
import { checkOkxKey, collectOkx, pingOkx } from '../sources/okx.ts';
import { seal, unseal, vaultKey } from '../storage/vault.ts';
import { EXCHANGES, type ExchangeKeys, type ExchangeKind, type KeyCheck } from '../domain/exchange.ts';
import type { CollectResult } from '../domain/types.ts';

export { EXCHANGE_KINDS, EXCHANGES, isExchange } from '../domain/exchange.ts';
export type { ExchangeKeys, ExchangeKind, KeyCheck } from '../domain/exchange.ts';

export interface ExchangeClient {
  check: (keys: ExchangeKeys) => Promise<KeyCheck>;
  collect: (keys: ExchangeKeys) => Promise<CollectResult>;
  ping: () => Promise<string>;
  passphrase: boolean;
  readOnly: string;
}

export const CLIENTS: Record<ExchangeKind, ExchangeClient> = {
  binance: {
    check: checkBinanceKey,
    collect: collectBinance,
    ping: pingBinance,
    passphrase: false,
    readOnly: 'Create a key with only Enable Reading ticked.',
  },
  bybit: {
    check: checkBybitKey,
    collect: collectBybit,
    ping: pingBybit,
    passphrase: false,
    readOnly: 'Create a system-generated key with Read-Only permissions.',
  },
  okx: {
    check: checkOkxKey,
    collect: collectOkx,
    ping: pingOkx,
    passphrase: true,
    readOnly: 'Create a key with only the Read permission.',
  },
};

export const fingerprint = (apiKey: string): string => createHash('sha256').update(apiKey).digest('hex').slice(0, 24);

export const keyHint = (apiKey: string): string => `…${apiKey.slice(-4)}`;

export function exchangeKeys(db: DatabaseSync, accountId: number): ExchangeKeys | null {
  const row = db.prepare('SELECT sealed FROM exchange_keys WHERE account_id = ?').get(accountId) as
    { sealed: string } | undefined;
  return row ? unseal<ExchangeKeys>(vaultKey(), row.sealed) : null;
}

export function exchangeHints(db: DatabaseSync): Map<number, string> {
  const rows = db.prepare('SELECT account_id, key_hint FROM exchange_keys').all() as unknown as {
    account_id: number;
    key_hint: string;
  }[];
  return new Map(rows.map((r) => [r.account_id, r.key_hint]));
}

export function addExchange(db: DatabaseSync, kind: ExchangeKind, keys: ExchangeKeys, label?: string): Account {
  const name = label?.trim() || EXCHANGES[kind];
  db.exec('BEGIN');
  try {
    const id = Number(
      db
        .prepare('INSERT INTO accounts (kind, label, address, address_key) VALUES (?, ?, ?, ?)')
        .run(kind, name, '', fingerprint(keys.apiKey)).lastInsertRowid,
    );
    storeKeys(db, id, keys);
    db.exec('COMMIT');
    return { id, kind, label: name, address: '' };
  } catch (err) {
    db.exec('ROLLBACK');
    if (err instanceof Error && /UNIQUE/.test(err.message)) throw new Error('This API key is already added');
    throw err;
  }
}

function storeKeys(db: DatabaseSync, accountId: number, keys: ExchangeKeys): void {
  db.prepare('INSERT OR REPLACE INTO exchange_keys (account_id, key_hint, sealed) VALUES (?, ?, ?)').run(
    accountId,
    keyHint(keys.apiKey),
    seal(vaultKey(), keys),
  );
}

export function importConfigExchange(db: DatabaseSync, keys: ExchangeKeys): Account | null {
  if (!keys.apiKey || !keys.apiSecret) return null;
  const print = fingerprint(keys.apiKey);
  if (getSetting(db, 'binance_config_imported') === print) return null;
  const legacy = db
    .prepare("SELECT id, label FROM accounts WHERE kind = 'binance' AND address_key = 'binance'")
    .get() as { id: number; label: string } | undefined;
  let account: Account | null = null;
  if (legacy) {
    db.prepare('UPDATE accounts SET address_key = ? WHERE id = ?').run(print, legacy.id);
    storeKeys(db, legacy.id, keys);
    account = { id: legacy.id, kind: 'binance', label: legacy.label, address: '' };
  } else if (!db.prepare("SELECT 1 FROM accounts WHERE kind = 'binance' AND address_key = ?").get(print)) {
    account = addExchange(db, 'binance', keys);
  }
  setSetting(db, 'binance_config_imported', print);
  return account;
}
