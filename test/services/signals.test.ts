import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createResolver, loadAssetRules } from '../../src/domain/assets.ts';
import type { Holding } from '../../src/domain/types.ts';
import { loadConfig } from '../../src/lib/config.ts';
import type { PricePoint } from '../../src/domain/indicators.ts';
import { findPair, refreshPriceHistories, runSignals } from '../../src/services/signals.ts';
import {
  ADMIN_ID,
  addWallet,
  finishSnapshot,
  noteContracts,
  openDb,
  priceChangesSince,
  priceHistories,
  saveOutcome,
  savePriceHistory,
  startSnapshot,
} from '../../src/storage/index.ts';

test('finds the right Binance markets for an asset', () => {
  const markets = {
    spot: new Set(['BTCUSDT', 'NVDABUSDT']),
    futures: new Set(['BTCUSDT', 'NVDAUSDT', '1000PEPEUSDT', 'PONSUSDT']),
  };
  assert.deepEqual(findPair({ key: 'BTC', category: 'BTC' }, markets), {
    candles: { market: 'spot', symbol: 'BTCUSDT' },
    perp: 'BTCUSDT',
  });
  assert.deepEqual(findPair({ key: 'NVDA', category: 'Stocks' }, markets), {
    candles: { market: 'spot', symbol: 'NVDABUSDT' },
    perp: null,
  });
  assert.deepEqual(findPair({ key: 'PONS', category: 'Other' }, markets), {
    candles: { market: 'futures', symbol: 'PONSUSDT' },
    perp: 'PONSUSDT',
  });
  assert.equal(findPair({ key: 'PEPE', category: 'Memes' }, markets).perp, '1000PEPEUSDT');
  assert.deepEqual(findPair({ key: 'NOPE', category: 'Other' }, markets), { candles: null, perp: null });
});

test('signals can be computed for some assets only, with the 24-hour change from the ticker', async (t) => {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  const wallet = addWallet(db, ADMIN_ID, '0x52908400098527886E0F7030069857D2E4169EE7');
  const snapshot = startSnapshot(db);
  const holding = (symbol: string, value: number): Holding => ({
    chain: 'ethereum',
    protocol: null,
    symbol,
    quantity: 1,
    price: value,
    value,
    type: 'wallet',
  });
  saveOutcome(db, snapshot, wallet.id, {
    status: 'ok',
    holdings: [holding('ETH', 2000), holding('WBTC', 3000)],
    warnings: [],
  });
  finishSnapshot(db, snapshot);

  const asked: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL) => {
    const { pathname, searchParams } = new URL(url);
    asked.push(searchParams.get('symbol') ?? pathname);
    const answers: Record<string, unknown> = {
      '/api/v3/ticker/price': [{ symbol: 'ETHUSDT' }, { symbol: 'BTCUSDT' }],
      '/fapi/v1/premiumIndex': [{ symbol: 'ETHUSDT' }, { symbol: 'BTCUSDT' }],
      '/api/v3/klines': Array.from({ length: 300 }, (_, i) => [0, 0, 0, 0, String(1000 + i)]),
      '/api/v3/ticker/24hr': { priceChangePercent: '-2.5' },
      '/fapi/v1/fundingRate': [{ fundingRate: '0.0001' }],
      '/futures/data/openInterestHist': Array.from({ length: 8 }, () => ({ sumOpenInterest: '100' })),
    };
    return new Response(JSON.stringify(answers[pathname]), { status: 200 });
  });

  const rows = await runSignals(
    db,
    loadConfig('config.example.json'),
    createResolver(loadAssetRules()),
    new Set(['ETH']),
  );
  assert.deepEqual(
    rows.map((r) => r.asset),
    ['ETH'],
  );
  assert.ok(!asked.includes('BTCUSDT'), 'nothing is asked about the other assets');
  const moves = priceChangesSince(db, '');
  assert.deepEqual([...moves.keys()], ['ETH']);
  assert.equal(moves.get('ETH')!.d1, -0.025);
  assert.ok(Math.abs(moves.get('ETH')!.d7! - (1299 / 1292 - 1)) < 1e-12);
});

const DAY_MS = 24 * 60 * 60 * 1000;

function walletWith(holdings: [chain: string, symbol: string, value: number][]) {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  const wallet = addWallet(db, ADMIN_ID, '0x52908400098527886E0F7030069857D2E4169EE7');
  const snapshot = startSnapshot(db);
  saveOutcome(db, snapshot, wallet.id, {
    status: 'ok',
    holdings: holdings.map(([chain, symbol, value]) => ({
      chain,
      protocol: null,
      symbol,
      quantity: 1,
      price: value,
      value,
      type: 'wallet' as const,
    })),
    warnings: [],
  });
  finishSnapshot(db, snapshot);
  return db;
}

const history = (days: number): PricePoint[] =>
  Array.from({ length: days }, (_, i) => [Date.UTC(2025, 0, 6) + i * DAY_MS, 1 + i]);

test('price histories are fetched a few at a time through the day, new ones first, each once a day', async (t) => {
  const db = walletWith([
    ['base', 'ANSEM', 50],
    ['ethereum', 'ANSEM', 5],
    ['base', 'YOUNG', 30],
    ['base', 'NOWHERE', 20],
    ['starknet', 'FAR', 40],
    ['base', 'DEGEN', 60],
    ['base', 'USDC', 100],
  ]);
  noteContracts(db, [
    { symbol: 'ANSEM', chain: 'ethereum', address: '0xbridged' },
    { symbol: 'ANSEM', chain: 'base', address: '0xansem' },
    { symbol: 'YOUNG', chain: 'base', address: '0xyoung' },
    { symbol: 'NOWHERE', chain: 'base', address: '0xnowhere' },
    { symbol: 'FAR', chain: 'starknet', address: '0xfar' },
    { symbol: 'DEGEN', chain: 'base', address: '0xdegen' },
    { symbol: 'USDC', chain: 'base', address: '0xusdc' },
  ]);
  let asked: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string | URL) => {
    const { hostname, pathname } = new URL(url);
    if (hostname !== 'api.coingecko.com') return new Response(JSON.stringify([{ symbol: 'DEGENUSDT' }]));
    const contract = pathname.split('/')[6]!;
    asked.push(contract);
    const known: Record<string, PricePoint[]> = { '0xansem': history(300), '0xyoung': history(30) };
    const prices = known[contract];
    return prices
      ? new Response(JSON.stringify({ prices: [...prices, [Date.UTC(2025, 10, 1, 8), 1]] }))
      : new Response(JSON.stringify({ error: 'coin not found' }), { status: 404 });
  });

  const config = loadConfig('config.example.json');
  const resolve = createResolver(loadAssetRules());
  const start = Date.UTC(2026, 10, 22, 10);
  const run = async (afterMs: number) => {
    asked = [];
    await refreshPriceHistories(db, config, resolve, 12 * 60 * 60 * 1000, start + afterMs, 0);
    return asked;
  };

  assert.deepEqual(await run(0), ['0xansem', '0xyoung']);
  assert.deepEqual(await run(60 * 60 * 1000), ['0xnowhere']);
  assert.deepEqual(await run(2 * 60 * 60 * 1000), []);
  assert.deepEqual(await run(DAY_MS), ['0xansem', '0xyoung']);

  const stored = priceHistories(db);
  assert.equal(stored.get('ANSEM')!.points!.length, 300, 'only whole days are kept');
  assert.equal(stored.get('NOWHERE')!.points, null);
});

test('a token without a Binance market is scored from its stored closes and the latest price', async (t) => {
  const db = walletWith([
    ['base', 'ANSEM', 301],
    ['base', 'YOUNG', 31],
  ]);
  savePriceHistory(db, 'ANSEM', history(300), new Date().toISOString());
  savePriceHistory(db, 'YOUNG', history(30), new Date().toISOString());
  const hosts = new Set<string>();
  t.mock.method(globalThis, 'fetch', async (url: string | URL) => {
    hosts.add(new URL(url).hostname);
    return new Response(JSON.stringify([]));
  });

  const rows = await runSignals(db, loadConfig('config.example.json'), createResolver(loadAssetRules()));
  assert.deepEqual(
    rows.map((r) => [r.asset, r.pair, r.components.map((c) => c.name)]),
    [['ANSEM', 'CoinGecko', ['rsiDaily', 'rsiWeekly', 'ma200']]],
    'a month of prices gives no weekly RSI, and one reading is not scored',
  );
  assert.ok(!hosts.has('api.coingecko.com'));
  const moves = priceChangesSince(db, '');
  assert.deepEqual([...moves.keys()].sort(), ['ANSEM', 'YOUNG']);
  assert.equal(moves.get('ANSEM')!.d1, null);
  assert.ok(Math.abs(moves.get('ANSEM')!.d7! - (301 / 294 - 1)) < 1e-12);
});
