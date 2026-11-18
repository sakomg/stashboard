import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Account } from '../storage/index.ts';
import { checkBinanceKey, collectBinance, pingBinance } from '../sources/binance.ts';
import { checkBybitKey, collectBybit, pingBybit } from '../sources/bybit.ts';
import { checkOkxKey, collectOkx, pingOkx } from '../sources/okx.ts';
import { checkGateKey, collectGate, pingGate } from '../sources/gate.ts';
import { checkBingxKey, collectBingx, pingBingx } from '../sources/bingx.ts';
import { seal, unseal, vaultKey } from '../storage/vault.ts';
import { EXCHANGES, type ExchangeKeys, type ExchangeKind, type KeyCheck } from '../domain/exchange.ts';
import type { CollectResult } from '../domain/types.ts';

export { EXCHANGE_KINDS, EXCHANGES, isExchange } from '../domain/exchange.ts';
export type { ExchangeKeys, ExchangeKind, KeyCheck } from '../domain/exchange.ts';

interface ExchangeClient {
  check: (keys: ExchangeKeys) => Promise<KeyCheck>;
  collect: (keys: ExchangeKeys) => Promise<CollectResult>;
  ping: () => Promise<string>;
  passphrase: boolean;
  readOnly: string;
  ipRequired: string | null;
}

export const CLIENTS: Record<ExchangeKind, ExchangeClient> = {
  binance: {
    check: checkBinanceKey,
    collect: collectBinance,
    ping: pingBinance,
    passphrase: false,
    readOnly: 'Create a key with only Enable Reading ticked.',
    ipRequired: null,
  },
  bybit: {
    check: checkBybitKey,
    collect: collectBybit,
    ping: pingBybit,
    passphrase: false,
    readOnly: 'Create a system-generated key with Read-Only permissions.',
    ipRequired: 'Bybit turns off a key that is not bound to an IP address after three months.',
  },
  okx: {
    check: checkOkxKey,
    collect: collectOkx,
    ping: pingOkx,
    passphrase: true,
    readOnly: 'Create a key with only the Read permission.',
    ipRequired: null,
  },
  gate: {
    check: checkGateKey,
    collect: collectGate,
    ping: pingGate,
    passphrase: false,
    readOnly: 'Set every permission of the key to Read Only and leave Withdraw off.',
    ipRequired: 'Gate turns off a key that is not bound to an IP address after 90 days.',
  },
  bingx: {
    check: checkBingxKey,
    collect: collectBingx,
    ping: pingBingx,
    passphrase: false,
    readOnly: 'Create a key with only Read ticked.',
    ipRequired: null,
  },
};

export function bindingAdvice(kind: ExchangeKind, ipRestricted: boolean, address: string | null): string | null {
  const reason = CLIENTS[kind].ipRequired;
  if (ipRestricted || !reason) return null;
  const where = address ? `this server's address, ${address},` : "this server's IP address";
  return `${reason} Bind the key to ${where} to keep it working.`;
}

const fingerprint = (apiKey: string): string => createHash('sha256').update(apiKey).digest('hex').slice(0, 24);

const keyHint = (apiKey: string): string => `…${apiKey.slice(-4)}`;

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

export function addExchange(
  db: DatabaseSync,
  userId: number,
  kind: ExchangeKind,
  keys: ExchangeKeys,
  label?: string,
): Account {
  const name = label?.trim() || EXCHANGES[kind];
  db.exec('BEGIN');
  try {
    const id = Number(
      db
        .prepare('INSERT INTO accounts (user_id, kind, label, address, address_key) VALUES (?, ?, ?, ?, ?)')
        .run(userId, kind, name, '', fingerprint(keys.apiKey)).lastInsertRowid,
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

export function replaceExchangeKeys(db: DatabaseSync, userId: number, accountId: number, keys: ExchangeKeys): boolean {
  db.exec('BEGIN');
  try {
    const changed = db
      .prepare('UPDATE accounts SET address_key = ? WHERE id = ? AND user_id = ?')
      .run(fingerprint(keys.apiKey), accountId, userId).changes;
    if (changed > 0) storeKeys(db, accountId, keys);
    db.exec('COMMIT');
    return changed > 0;
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
