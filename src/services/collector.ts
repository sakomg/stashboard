import type { DatabaseSync } from 'node:sqlite';
import { errorText } from '../lib/errors.ts';
import type { Config } from '../lib/config.ts';
import {
  currentState,
  listUsers,
  finishSnapshot,
  listAccounts,
  noteContracts,
  saveOutcome,
  startSnapshot,
  type Account,
  type AccountState,
} from '../storage/index.ts';
import { CLIENTS, exchangeKeys, isExchange } from './exchanges.ts';
import { noteLogos } from './logos.ts';
import { collectAster } from '../sources/aster.ts';
import { collectLighter } from '../sources/lighter.ts';
import { collectTon } from '../sources/ton.ts';
import { collectZerion } from '../sources/zerion.ts';
import type { CollectResult, Holding } from '../domain/types.ts';

export type ProgressEvent =
  | { type: 'start'; accounts: Account[] }
  | { type: 'reading'; accountId: number }
  | { type: 'waiting'; accountId: number; note: string }
  | { type: 'done'; accountId: number; ok: boolean; note?: string }
  | { type: 'saved'; accountIds: number[] };

type Notify = (event: ProgressEvent) => void;

interface RunOptions {
  only?: number[];
  defiEveryMs?: number;
}

function collectAccount(
  db: DatabaseSync,
  config: Config,
  account: Account,
  notify: Notify,
  defiEveryMs?: number,
): Promise<CollectResult> {
  const onWait = (note: string): void => notify({ type: 'waiting', accountId: account.id, note });
  if (isExchange(account.kind)) {
    const keys = exchangeKeys(db, account.id);
    if (!keys) throw new Error('No API key is stored for this exchange. Remove it and add it again.');
    return CLIENTS[account.kind].collect(keys);
  }
  switch (account.kind) {
    case 'evm':
      if (!config.zerion.apiKey) throw new Error('Zerion key is not set in config.json');
      return collectEvm(db, config.zerion.apiKey, account.address, onWait, defiEveryMs);
    case 'solana':
      if (!config.zerion.apiKey) throw new Error('Zerion key is not set in config.json');
      return collectZerion(db, config.zerion.apiKey, account.address, 'solana', { onWait });
    case 'ton':
      return collectTon(config.tonapi.apiKey, account.address, onWait);
  }
}

async function collectEvm(
  db: DatabaseSync,
  apiKey: string,
  address: string,
  onWait: (note: string) => void,
  defiEveryMs?: number,
): Promise<CollectResult> {
  const indexed = await collectZerion(db, apiKey, address, 'evm', { onWait, defiEveryMs });
  const venues = [await collectLighter(address), await collectAster(address)];
  return {
    holdings: [...indexed.holdings, ...venues.flatMap((v) => v.holdings)],
    warnings: [...indexed.warnings, ...venues.flatMap((v) => v.warnings)],
    logos: [...(indexed.logos ?? []), ...venues.flatMap((v) => v.logos ?? [])],
    contracts: indexed.contracts ?? [],
  };
}

function notePrices(holdings: Holding[], prices: Map<string, number>): Map<string, number> {
  for (const h of holdings) {
    if (!h.readAt && h.price && h.price > 0 && !prices.has(h.symbol.toUpperCase()))
      prices.set(h.symbol.toUpperCase(), h.price);
  }
  return prices;
}

export function repriceEarlierReads(holdings: Holding[], prices = notePrices(holdings, new Map())): Holding[] {
  return holdings.map((h) => {
    if (!h.readAt) return h;
    const symbol = h.symbol.toUpperCase();
    const price = prices.get(symbol) ?? (/^W[A-Z]{3,}$/.test(symbol) ? prices.get(symbol.slice(1)) : undefined);
    if (!price) return h;
    const value = Math.abs(h.quantity) * price;
    return { ...h, price, value: h.value < 0 ? -value : value };
  });
}

function largestFirst(states: AccountState[]): Account[] {
  return states
    .map((s) => ({ account: s.account, value: s.holdings.reduce((sum, h) => sum + h.value, 0) }))
    .sort((a, b) => b.value - a.value)
    .map((s) => s.account);
}

const personByPerson = (db: DatabaseSync): Account[][] =>
  listUsers(db).map((user) => largestFirst(currentState(db, user.id)));

interface Read {
  account: Account;
  result?: CollectResult;
  error?: string;
}

function savePerson(db: DatabaseSync, reads: Read[], prices: Map<string, number>): number | null {
  const fresh = reads.flatMap((r) => r.result?.holdings ?? []);
  const repriced = repriceEarlierReads(fresh, notePrices(fresh, prices));
  const present = new Set(listAccounts(db, 'all').map((a) => a.id));
  if (!reads.some((r) => present.has(r.account.id))) return null;
  const snapshotId = startSnapshot(db);
  let next = 0;
  for (const { account, result, error } of reads) {
    const holdings = result ? repriced.slice(next, (next += result.holdings.length)) : [];
    if (!present.has(account.id)) continue;
    if (!result) {
      saveOutcome(db, snapshotId, account.id, { status: 'error', error: error ?? 'unknown error' });
      continue;
    }
    saveOutcome(db, snapshotId, account.id, { status: 'ok', ...result, holdings });
    if (result.logos) noteLogos(db, result.logos);
    if (result.contracts) noteContracts(db, result.contracts);
  }
  finishSnapshot(db, snapshotId);
  return snapshotId;
}

export async function runCollection(
  db: DatabaseSync,
  config: Config,
  notify: Notify = () => {},
  { only, defiEveryMs }: RunOptions = {},
): Promise<number[]> {
  const people = personByPerson(db)
    .map((accounts) => accounts.filter((a) => !only || only.includes(a.id)))
    .filter((accounts) => accounts.length > 0);
  if (people.length === 0) return [];
  notify({ type: 'start', accounts: people.flat() });
  const prices = new Map<string, number>();
  const snapshots: number[] = [];
  for (const accounts of people) {
    const reads: Read[] = [];
    for (const account of accounts) {
      notify({ type: 'reading', accountId: account.id });
      try {
        const result = await collectAccount(db, config, account, notify, defiEveryMs);
        reads.push({ account, result });
        notify({ type: 'done', accountId: account.id, ok: true });
      } catch (err) {
        const error = errorText(err);
        reads.push({ account, error });
        notify({ type: 'done', accountId: account.id, ok: false, note: error });
      }
    }
    const snapshotId = savePerson(db, reads, prices);
    if (snapshotId !== null) snapshots.push(snapshotId);
    notify({ type: 'saved', accountIds: accounts.map((a) => a.id) });
  }
  return snapshots;
}

export interface UpdateGate {
  allowed: boolean;
  reason: string | null;
  availableAt: number | null;
}

export function updateGate({
  running,
  lastStartedAt,
  gapMinutes,
  zerionWallets,
  zerionUsedUp,
  zerionRenewsAt,
  now = Date.now(),
}: {
  running: boolean;
  lastStartedAt: number;
  gapMinutes: number;
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
  const availableAt = lastStartedAt + gapMinutes * 60_000;
  if (now < availableAt) {
    return {
      allowed: false,
      reason:
        zerionWallets > 0 ? `Zerion's daily allowance fits one update every ${gapMinutes} min` : 'Updated a moment ago',
      availableAt,
    };
  }
  return { allowed: true, reason: null, availableAt: null };
}
