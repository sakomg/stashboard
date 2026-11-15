import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { getSetting, setSetting, type Account } from '../storage/index.ts';
import { HttpError } from '../lib/http.ts';
import { binanceSigned } from '../sources/binance.ts';
import { seal, unseal, vaultKey } from '../storage/vault.ts';

export interface ExchangeKeys {
  apiKey: string;
  apiSecret: string;
}

export const EXCHANGES = { binance: 'Binance' } as const;
export type ExchangeKind = keyof typeof EXCHANGES;

const PERMISSIONS: Record<string, string> = {
  enableSpotAndMarginTrading: 'spot and margin trading',
  enableMargin: 'margin',
  enableFutures: 'futures trading',
  enableWithdrawals: 'withdrawals',
  enableInternalTransfer: 'internal transfers',
  permitsUniversalTransfer: 'universal transfers',
  enableVanillaOptions: 'options trading',
  enableFixApiTrade: 'FIX API trading',
  enableFixReadOnly: 'FIX API',
  enablePortfolioMarginTrading: 'portfolio margin trading',
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

export async function checkBinanceKey(keys: ExchangeKeys): Promise<{ extra: string[]; ipRestricted: boolean }> {
  let restrictions: Record<string, unknown>;
  try {
    restrictions = await binanceSigned<Record<string, unknown>>(keys, '/sapi/v1/account/apiRestrictions');
  } catch (err) {
    if (err instanceof HttpError && err.status >= 400 && err.status < 500) {
      throw new Error(
        "Binance refused the key. Check the API key and the secret, and that the key allows this server's IP address.",
      );
    }
    throw err;
  }
  const extra = Object.entries(restrictions)
    .filter(([name, on]) => on === true && name !== 'enableReading' && name !== 'ipRestrict')
    .map(([name]) => PERMISSIONS[name] ?? name);
  return { extra, ipRestricted: restrictions.ipRestrict === true };
}
