// One collection run: reads every account and stores the result as a snapshot.
import type { DatabaseSync } from 'node:sqlite';
import type { Config } from './config.ts';
import { ensureExchangeAccount, finishSnapshot, listAccounts, saveOutcome, startSnapshot, type Account } from './db.ts';
import { noteLogos } from './logos.ts';
import { collectBinance } from './sources/binance.ts';
import { collectLighter } from './sources/lighter.ts';
import { collectTon } from './sources/ton.ts';
import { collectZerion } from './sources/zerion.ts';
import type { CollectResult, Holding } from './types.ts';

/** What a run is doing, for a page that wants to show it. */
export type ProgressEvent =
  | { type: 'start'; accounts: Account[] }
  | { type: 'reading'; accountId: number }
  | { type: 'waiting'; accountId: number; note: string }
  | { type: 'done'; accountId: number; ok: boolean; note?: string };

type Notify = (event: ProgressEvent) => void;

function collectAccount(db: DatabaseSync, config: Config, account: Account, notify: Notify): Promise<CollectResult> {
  const onWait = (note: string): void => notify({ type: 'waiting', accountId: account.id, note });
  switch (account.kind) {
    case 'binance':
      return collectBinance(config.binance);
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

/** An EVM address is read twice: Zerion for chains and protocols, Lighter for what sits on its exchange. */
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

/**
 * Holdings that come from an earlier answer keep their quantity but take today's price, when this run read
 * the same token somewhere else. A wrapped token (WETH, WBTC) takes the price of what it wraps.
 */
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

/** Collects all accounts. A failing account is recorded as an error and does not stop the others. */
export async function runCollection(db: DatabaseSync, config: Config, notify: Notify = () => {}): Promise<number> {
  if (config.binance.apiKey && config.binance.apiSecret) ensureExchangeAccount(db, 'binance', 'Binance');

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

  // Prices are settled across all accounts before anything is stored.
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
