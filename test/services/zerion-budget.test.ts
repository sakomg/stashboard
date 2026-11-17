import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import { repriceEarlierReads, updateGate } from '../../src/services/collector.ts';
import { ADMIN_ID, addWallet, finishSnapshot, openDb, saveOutcome, startSnapshot } from '../../src/storage/index.ts';
import { collectZerion, resetZerionQuota, zerionPaceMs, zerionQuota, zerionTiming } from '../../src/sources/zerion.ts';
import type { Holding } from '../../src/domain/types.ts';

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

function fakeZerion({
  simple = 200,
  complex = 200,
  remaining = 200,
  limit = 300,
  defi = [position('WETH', 'deposit', 2000, 'Aave V3')],
} = {}) {
  globalThis.fetch = (async (url: string | URL) => {
    const filter = new URL(url).searchParams.get('filter[positions]') ?? 'chains';
    calls.push(filter);
    const status = filter === 'only_complex' ? complex : filter === 'only_simple' ? simple : 200;
    const headers = {
      'ratelimit-org-tier': 'demo',
      'ratelimit-org-day-limit': String(limit),
      'ratelimit-org-day-remaining': String(remaining),
      'ratelimit-org-day-reset': '3600',
    };
    const data = filter === 'only_complex' ? defi : [position('ETH', 'wallet', 1000)];
    const body = status === 200 ? { data } : { errors: [{ title: 'Too many requests' }] };
    return new Response(JSON.stringify(body), { status, headers });
  }) as typeof fetch;
}

const freshDb = () => openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));

beforeEach(() => {
  calls = [];
  resetZerionQuota();
  Object.assign(zerionTiming, {
    minIntervalMs: 0,
    slowIntervalMs: 5,
    slowForMs: 60 * 60_000,
    retryPausesMs: [0, 0, 0],
  });
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

  calls = [];
  await collectZerion(db, 'key', ADDRESS, 'evm', { now: Date.now() + 60 * 60_000, defiEveryMs: 130 * 60_000 });
  assert.deepEqual(calls, ['only_simple']);
});

test('DeFi positions are read again once the planned interval for them has passed', async () => {
  const db = freshDb();
  fakeZerion({ limit: 2000 });
  await collectZerion(db, 'key', ADDRESS, 'evm');
  calls = [];
  await collectZerion(db, 'key', ADDRESS, 'evm', { now: Date.now() + 60 * 60_000, defiEveryMs: 55 * 60_000 });
  assert.deepEqual(calls, ['only_simple', 'only_complex']);
  assert.equal(zerionQuota().dayLimit, 2000);
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
  const wallet = addWallet(db, ADMIN_ID, ADDRESS);
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

test('Lighter as Zerion reports it is left out, since Lighter is read from its own API', async () => {
  const db = freshDb();
  fakeZerion({ defi: [position('WETH', 'deposit', 2000, 'Aave V3'), position('USDC', 'deposit', 450, 'lighter')] });
  const result = await collectZerion(db, 'key', ADDRESS, 'evm');
  assert.deepEqual(
    result.holdings.map((h) => h.protocol),
    [null, 'Aave V3'],
  );
  assert.equal(
    result.logos?.some((l) => l.kind === 'protocol' && l.key === 'lighter'),
    false,
  );
});

test('requests go out fast until Zerion refuses one, then slowly for an hour', async () => {
  const db = freshDb();
  assert.equal(zerionPaceMs(), 0);
  let refused = false;
  globalThis.fetch = (async (url: string | URL) => {
    calls.push(new URL(url).searchParams.get('filter[positions]') ?? 'chains');
    const headers = { 'ratelimit-org-day-limit': '2000', 'ratelimit-org-day-remaining': '1900' };
    if (!refused) {
      refused = true;
      return new Response('{"errors":[{"title":"Too many requests"}]}', { status: 429, headers });
    }
    return new Response(JSON.stringify({ data: [position('ETH', 'wallet', 1000)] }), { status: 200, headers });
  }) as typeof fetch;
  await collectZerion(db, 'key', ADDRESS, 'solana');
  assert.deepEqual(calls, ['only_simple', 'only_simple']);
  assert.equal(zerionPaceMs(), 5);
  assert.equal(zerionPaceMs(Date.now() + 60 * 60_000 + 1), 0);
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

test('updates are refused while one runs, until the planned gap has passed, or when Zerion has nothing left', () => {
  const now = Date.now();
  const base = {
    running: false,
    lastStartedAt: 0,
    gapMinutes: 15,
    zerionWallets: 2,
    zerionUsedUp: false,
    zerionRenewsAt: null,
    now,
  };
  assert.deepEqual(updateGate(base), { allowed: true, reason: null, availableAt: null });
  assert.equal(updateGate({ ...base, running: true }).allowed, false);

  const soon = updateGate({ ...base, lastStartedAt: now - 5 * 60_000 });
  assert.equal(soon.allowed, false);
  assert.equal(soon.availableAt, now + 10 * 60_000);
  assert.match(soon.reason ?? '', /one update every 15 min/);
  assert.equal(updateGate({ ...base, lastStartedAt: now - 15 * 60_000 }).allowed, true);

  const renews = now + 5 * 3_600_000;
  const usedUp = updateGate({ ...base, zerionUsedUp: true, zerionRenewsAt: renews });
  assert.equal(usedUp.allowed, false);
  assert.equal(usedUp.availableAt, renews);
  assert.match(usedUp.reason ?? '', /resume in about 5 h/);

  assert.equal(updateGate({ ...base, zerionWallets: 0, zerionUsedUp: true }).allowed, true);
  assert.equal(
    updateGate({ ...base, zerionWallets: 0, gapMinutes: 1, lastStartedAt: now - 20_000 }).reason,
    'Updated a moment ago',
  );
});
