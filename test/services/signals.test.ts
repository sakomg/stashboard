import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findPair } from '../../src/services/signals.ts';

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
