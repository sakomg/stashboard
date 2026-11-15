import type { DatabaseSync } from 'node:sqlite';
import type { Config } from './config.ts';
import { finishSnapshot, listAccounts, saveOutcome, startSnapshot, type Account } from './db.ts';
import { exchangeKeys } from './exchanges.ts';
import { noteLogos } from './logos.ts';
import { collectBinance } from './sources/binance.ts';
import { collectLighter } from './sources/lighter.ts';
import { collectTon } from './sources/ton.ts';
import { collectZerion } from './sources/zerion.ts';
import type { CollectResult, Holding } from './types.ts';

export type ProgressEvent =
  | { type: 'start'; accounts: Account[] }
  | { type: 'reading'; accountId: number }
  | { type: 'waiting'; accountId: number; note: string }
  | { type: 'done'; accountId: number; ok: boolean; note?: string };

type Notify = (event: ProgressEvent) => void;

function collectAccount(db: DatabaseSync, config: Config, account: Account, notify: Notify): Promise<CollectResult> {
  const onWait = (note: string): void => notify({ type: 'waiting', accountId: account.id, note });
  switch (account.kind) {
    case 'binance': {
      const keys = exchangeKeys(db, account.id);
      if (!keys) throw new Error('No API key is stored for this exchange. Remove it and add it again.');
      return collectBinance(keys);
    }
    case 'evm':
      if (!config.zerion.apiKey) throw new Error('Zerion key is not set in config.json');
      return collectEvm(db, config.zerion.apiKey, account.address, onWait);
    case 'solana':
      if (!config.zerion.apiKey) throw new Error('Zerion key is not set in config.json');
      return collectZerion(db, config.zerion.apiKey, account.address, 'solana', { onWait });
    case 'ton':
      return collectTon(config.tonapi.apiKey, account.address);
  }
}

async function collectEvm(
  db: DatabaseSync,
  apiKey: string,
  address: string,
  onWait: (note: string) => void,
): Promise<CollectResult> {
  const indexed = await collectZerion(db, apiKey, address, 'evm', { onWait });
  const lighter = await collectLighter(address);
  return {
    holdings: [...indexed.holdings, ...lighter.holdings],
    warnings: [...indexed.warnings, ...lighter.warnings],
    logos: [...(indexed.logos ?? []), ...(lighter.logos ?? [])],
  };
}

export function repriceEarlierReads(holdings: Holding[]): Holding[] {
  const prices = new Map<string, number>();
  for (const h of holdings) {
    if (!h.readAt && h.price && h.price > 0 && !prices.has(h.symbol.toUpperCase()))
      prices.set(h.symbol.toUpperCase(), h.price);
  }
  return holdings.map((h) => {
    if (!h.readAt) return h;
    const symbol = h.symbol.toUpperCase();
    const price = prices.get(symbol) ?? (/^W[A-Z]{3,}$/.test(symbol) ? prices.get(symbol.slice(1)) : undefined);
    if (!price) return h;
    const value = Math.abs(h.quantity) * price;
    return { ...h, price, value: h.value < 0 ? -value : value };
  });
}

export async function runCollection(db: DatabaseSync, config: Config, notify: Notify = () => {}): Promise<number> {
  const accounts = listAccounts(db);
  notify({ type: 'start', accounts });
  const results: { account: Account; result?: CollectResult; error?: string }[] = [];
  for (const account of accounts) {
    notify({ type: 'reading', accountId: account.id });
    try {
      const result = await collectAccount(db, config, account, notify);
      results.push({ account, result });
      notify({ type: 'done', accountId: account.id, ok: true });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ account, error });
      notify({ type: 'done', accountId: account.id, ok: false, note: error });
    }
  }

  const repriced = repriceEarlierReads(results.flatMap((r) => r.result?.holdings ?? []));
  const snapshotId = startSnapshot(db);
  let next = 0;
  for (const { account, result, error } of results) {
    if (!result) {
      saveOutcome(db, snapshotId, account.id, { status: 'error', error: error ?? 'unknown error' });
      continue;
    }
    const holdings = repriced.slice(next, (next += result.holdings.length));
    saveOutcome(db, snapshotId, account.id, { status: 'ok', ...result, holdings });
    if (result.logos) noteLogos(db, result.logos);
  }
  finishSnapshot(db, snapshotId);
  return snapshotId;
}

export interface UpdateGate {
  allowed: boolean;
  reason: string | null;
  availableAt: number | null;
}

export const UPDATE_COOLDOWN_MS = 60_000;

export function updateGate({
  running,
  lastFinishedAt,
  zerionWallets,
  zerionUsedUp,
  zerionRenewsAt,
  now = Date.now(),
}: {
  running: boolean;
  lastFinishedAt: number;
  zerionWallets: number;
  zerionUsedUp: boolean;
  zerionRenewsAt: number | null;
  now?: number;
}): UpdateGate {
  if (running) return { allowed: false, reason: 'An update is running', availableAt: null };
  if (zerionWallets > 0 && zerionUsedUp) {
    const hours = zerionRenewsAt ? Math.max(1, Math.ceil((zerionRenewsAt - now) / 3_600_000)) : null;
    return {
      allowed: false,
      reason: `Zerion's daily allowance is used up${hours ? `. Updates resume in about ${hours} h` : ''}`,
      availableAt: zerionRenewsAt,
    };
  }
  if (now - lastFinishedAt < UPDATE_COOLDOWN_MS) {
    return { allowed: false, reason: 'Updated a moment ago', availableAt: lastFinishedAt + UPDATE_COOLDOWN_MS };
  }
  return { allowed: true, reason: null, availableAt: null };
}
