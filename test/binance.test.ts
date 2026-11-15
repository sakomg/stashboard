import assert from 'node:assert/strict';
import { test } from 'node:test';
import { priceFrom } from '../src/sources/binance.ts';

const tickers = new Map([
  ['BTCUSDT', 60000],
  ['USDCUSDT', 1.001],
  ['FOOBTC', 0.0001],
  ['BARUSDC', 2],
  ['USDTTRY', 40],
]);

test('prices an asset through USDT or the nearest quote', () => {
  assert.equal(priceFrom(tickers, 'USDT'), 1);
  assert.equal(priceFrom(tickers, 'BTC'), 60000);
  assert.equal(priceFrom(tickers, 'FOO'), 6);
  assert.equal(priceFrom(tickers, 'BAR'), 2.002);
  assert.equal(priceFrom(tickers, 'TRY'), 1 / 40);
  assert.equal(priceFrom(tickers, 'NOPE'), null);
});
