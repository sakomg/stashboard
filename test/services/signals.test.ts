import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createResolver, loadAssetRules } from '../../src/domain/assets.ts';
import type { Holding } from '../../src/domain/types.ts';
import { loadConfig } from '../../src/lib/config.ts';
import { findPair, runSignals } from '../../src/services/signals.ts';
import {
  ADMIN_ID,
  addWallet,
  finishSnapshot,
  openDb,
  priceChangesSince,
  saveOutcome,
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
