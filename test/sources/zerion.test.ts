import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test } from 'node:test';
import {
  collectZerion,
  resetZerionQuota,
  withoutDepositReceipts,
  zerionPaceMs,
  zerionQuota,
  zerionTiming,
  type ZerionPosition,
} from '../../src/sources/zerion.ts';
import { openDb } from '../../src/storage/index.ts';

const position = (chain: string, type: string, symbol: string, protocol: string | null = null): ZerionPosition => ({
  chain,
  type,
  protocol,
  symbol,
  quantity: 1,
  price: 1,
  value: 1,
  icon: null,
  protocolIcon: null,
});

test('a lending receipt is not counted next to the deposit it stands for', () => {
  const kept = withoutDepositReceipts([
    position('arbitrum', 'deposit', 'WETH', 'Aave V3'),
    position('arbitrum', 'wallet', 'aEthWETH'),
    position('arbitrum', 'deposit', 'WBTC', 'Aave V3'),
    position('arbitrum', 'wallet', 'aEthWBTC'),
    position('arbitrum', 'wallet', 'ETH'),
  ]);
  assert.deepEqual(
    kept.map((p) => `${p.type} ${p.symbol}`),
    ['deposit WETH', 'deposit WBTC', 'wallet ETH'],
  );
});

test('a receipt is kept when its deposit is not listed, or is on another chain', () => {
  const positions = [
    position('base', 'wallet', 'aBasUSDC'),
    position('arbitrum', 'wallet', 'aArbWETH'),
    position('ethereum', 'deposit', 'WETH', 'Aave V3'),
  ];
  assert.deepEqual(withoutDepositReceipts(positions), positions);
});

const ADDRESS = '0x52908400098527886E0F7030069857D2E4169EE7';
const realFetch = globalThis.fetch;
let calls: string[] = [];

function apiPosition(
  symbol: string,
  type: string,
  value: number,
  protocol: string | null = null,
  implementations: { chain_id: string; address: string | null }[] = [],
) {
  return {
    attributes: {
      position_type: type,
      protocol,
      quantity: { float: 1 },
      price: value,
      value,
      fungible_info: { symbol, implementations },
    },
    relationships: { chain: { data: { id: 'arbitrum' } } },
  };
}

function fakeZerion({
  simple = 200,
  complex = 200,
  remaining = 200,
  limit = 300,
  defi = [apiPosition('WETH', 'deposit', 2000, 'Aave V3')],
  wallet = [apiPosition('ETH', 'wallet', 1000)],
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
    const data = filter === 'only_complex' ? defi : wallet;
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

test('a token names its contract on the chain it is held on', async () => {
  fakeZerion({
    wallet: [
      apiPosition('ETH', 'wallet', 1000, null, [{ chain_id: 'arbitrum', address: null }]),
      apiPosition('ANSEM', 'wallet', 50, null, [
        { chain_id: 'base', address: '0xbase' },
        { chain_id: 'arbitrum', address: '0xarbitrum' },
      ]),
      apiPosition('DUST', 'wallet', 0, null, [{ chain_id: 'arbitrum', address: '0xdust' }]),
    ],
  });
  const { contracts } = await collectZerion(freshDb(), 'key', ADDRESS, 'evm');
  assert.deepEqual(contracts, [{ symbol: 'ANSEM', chain: 'arbitrum', address: '0xarbitrum' }]);
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

test('Lighter as Zerion reports it is left out, since Lighter is read from its own API', async () => {
  const db = freshDb();
  fakeZerion({
    defi: [apiPosition('WETH', 'deposit', 2000, 'Aave V3'), apiPosition('USDC', 'deposit', 450, 'lighter')],
  });
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
    return new Response(JSON.stringify({ data: [apiPosition('ETH', 'wallet', 1000)] }), { status: 200, headers });
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
