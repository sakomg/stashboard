import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { repriceEarlierReads } from '../src/collector.ts';
import { addWallet, finishSnapshot, openDb, saveOutcome, startSnapshot } from '../src/db.ts';
import { collectZerion, resetZerionQuota, zerionQuota, zerionTiming } from '../src/sources/zerion.ts';
import type { Holding } from '../src/types.ts';

const ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';
const realFetch = globalThis.fetch;
let calls: string[] = [];

function position(symbol: string, type: string, value: number, protocol: string | null = null) {
  return {
    attributes: {
      position_type: type,
      protocol,
      quantity: { float: 1 },
      price: value,
      value,
      fungible_info: { symbol },
    },
    relationships: { chain: { data: { id: 'arbitrum' } } },
  };
}

/** Answers Zerion requests: plain tokens, DeFi positions, or a refusal for either. */
function fakeZerion({ simple = 200, complex = 200, remaining = 200 } = {}) {
  globalThis.fetch = (async (url: string | URL) => {
    const filter = new URL(url).searchParams.get('filter[positions]') ?? 'chains';
    calls.push(filter);
    const status = filter === 'only_complex' ? complex : filter === 'only_simple' ? simple : 200;
    const headers = {
      'ratelimit-org-tier': 'demo',
      'ratelimit-org-day-limit': '300',
      'ratelimit-org-day-remaining': String(remaining),
      'ratelimit-org-day-reset': '3600',
    };
    const data =
      filter === 'only_complex' ? [position('WETH', 'deposit', 2000, 'Aave V3')] : [position('ETH', 'wallet', 1000)];
    const body = status === 200 ? { data } : { errors: [{ title: 'Too many requests' }] };
    return new Response(JSON.stringify(body), { status, headers });
  }) as typeof fetch;
}

const freshDb = () => openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));

beforeEach(() => {
  calls = [];
  resetZerionQuota();
  Object.assign(zerionTiming, { minIntervalMs: 0, retryPausesMs: [0, 0, 0] });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test('an EVM wallet is read as tokens and DeFi positions, then reused instead of asked again', async () => {
  const db = freshDb();
  fakeZerion();
  const first = await collectZerion(db, 'key', ADDRESS, 'evm');
  assert.deepEqual(calls, ['only_simple', 'only_complex']);
  assert.deepEqual(
    first.holdings.map((h) => [h.symbol, h.type, h.readAt]),
    [
      ['ETH', 'wallet', null],
      ['WETH', 'deposit', null],
    ],
  );
  assert.equal(zerionQuota().dayRemaining, 200);

  calls = [];
  const again = await collectZerion(db, 'key', ADDRESS, 'evm');
  assert.deepEqual(calls, [], 'a second update minutes later costs nothing');
  assert.ok(again.holdings.every((h) => h.readAt));

  // An hour later the tokens are read again; DeFi positions wait for their own, longer interval.
  calls = [];
  await collectZerion(db, 'key', ADDRESS, 'evm', { now: Date.now() + 60 * 60_000 });
  assert.deepEqual(calls, ['only_simple']);
});

test('a refused DeFi read keeps the earlier positions, says so, and is not repeated', async () => {
  const db = freshDb();
  fakeZerion();
  await collectZerion(db, 'key', ADDRESS, 'evm');

  fakeZerion({ complex: 429 });
  calls = [];
  const later = Date.now() + 4 * 60 * 60_000;
  const result = await collectZerion(db, 'key', ADDRESS, 'evm', { now: later });
  assert.deepEqual(calls, ['only_simple', 'only_complex', 'only_complex']);
  assert.ok(result.holdings.some((h) => h.symbol === 'WETH' && h.readAt));
  assert.match(result.warnings.join(' '), /DeFi positions are from 4 h ago.*allowance/);
  assert.ok(zerionQuota().defiBlockedUntil > Date.now());

  calls = [];
  await collectZerion(db, 'key', ADDRESS, 'evm', { now: later + 60 * 60_000 });
  assert.deepEqual(calls, ['only_simple'], 'no DeFi request while its allowance is used up');
});

test('with nothing kept yet, a refused DeFi read falls back to the positions stored last time', async () => {
  const db = freshDb();
  const wallet = addWallet(db, ADDRESS);
  const snapshot = startSnapshot(db);
  const stored: Holding[] = [
    { chain: 'arbitrum', protocol: 'Aave V3', symbol: 'WETH', quantity: 1, price: 2000, value: 2000, type: 'deposit' },
    { chain: 'arbitrum', protocol: 'Aave V3', symbol: 'USDC', quantity: 500, price: 1, value: -500, type: 'borrow' },
    { chain: 'ethereum', protocol: 'Lighter', symbol: 'USDC', quantity: 400, price: 1, value: 400, type: 'futures' },
  ];
  saveOutcome(db, snapshot, wallet.id, { status: 'ok', holdings: stored, warnings: [] });
  finishSnapshot(db, snapshot);

  fakeZerion({ complex: 429 });
  const result = await collectZerion(db, 'key', ADDRESS, 'evm');
  assert.deepEqual(
    result.holdings.filter((h) => h.protocol).map((h) => [h.symbol, h.type, h.value]),
    [
      ['WETH', 'deposit', 2000],
      ['USDC', 'borrow', -500],
    ],
    'DeFi comes back from the store, Lighter (read separately) does not',
  );
});

test('nothing is sent once the daily allowance is down to its reserve', async () => {
  const db = freshDb();
  fakeZerion({ remaining: 5 });
  await collectZerion(db, 'key', ADDRESS, 'solana');
  calls = [];
  const result = await collectZerion(db, 'key', ADDRESS, 'solana', { now: Date.now() + 60 * 60_000 });
  assert.deepEqual(calls, []);
  assert.match(result.warnings.join(' '), /daily allowance is used up/);
  assert.equal(result.holdings.length, 1);
});

test('positions from an earlier read take the price this run found for the same token', () => {
  const holding = (symbol: string, value: number, readAt: string | null, type: Holding['type'] = 'wallet') => ({
    chain: 'arbitrum',
    protocol: null,
    symbol,
    quantity: 2,
    price: Math.abs(value) / 2,
    value,
    type,
    readAt,
  });
  const earlier = '2026-01-01T00:00:00.000Z';
  const repriced = repriceEarlierReads([
    holding('ETH', 4000, null),
    holding('WETH', 3000, earlier, 'deposit'),
    holding('ETH', -3000, earlier, 'borrow'),
    holding('PONS', 10, earlier),
  ]);
  assert.deepEqual(
    repriced.map((h) => h.value),
    [4000, 4000, -4000, 10],
  );
});
