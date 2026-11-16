import assert from 'node:assert/strict';
import { test } from 'node:test';
import { priceChange } from '../../src/domain/indicators.ts';
import { estimateChange } from '../../src/domain/portfolio.ts';

const flat = (category: string) => category === 'Stablecoins';

test('a price change compares the last close with the one so many days before', () => {
  const closes = [100, 90, 80, 70, 60, 50, 40, 30, 120];
  assert.equal(priceChange(closes, 7), 120 / 90 - 1);
  assert.equal(priceChange(closes, 8), 120 / 100 - 1);
  assert.equal(priceChange(closes, 30), null);
  assert.equal(priceChange([0, 5], 1), null);
});

test("an estimate prices today's holdings as they were, with stablecoins flat", () => {
  const estimate = estimateChange(
    [
      { key: 'ETH', category: 'ETH', value: 1100 },
      { key: 'USDC', category: 'Stablecoins', value: 900 },
    ],
    (asset) => ({ ETH: 0.1 })[asset],
    flat,
  );
  assert.ok(estimate);
  assert.equal(estimate.coverage, 1);
  assert.ok(Math.abs(estimate.change - (2000 / 1900 - 1)) < 1e-12);
});

test('a debt grows when what was borrowed gets dearer', () => {
  const estimate = estimateChange(
    [
      { key: 'BTC', category: 'BTC', value: 3000 },
      { key: 'ETH', category: 'ETH', value: -1000 },
    ],
    (asset) => ({ BTC: 0, ETH: 0.25 })[asset],
    flat,
  );
  assert.ok(estimate);
  assert.ok(Math.abs(estimate.change - (2000 / 2200 - 1)) < 1e-12);
});

test('assets without a price history are left out, and too little coverage gives no estimate', () => {
  const assets = [
    { key: 'ETH', category: 'ETH', value: 600 },
    { key: 'NEW', category: 'Other', value: 400 },
  ];
  const partial = estimateChange(assets, (asset) => ({ ETH: 0.2 })[asset], flat);
  assert.ok(partial);
  assert.equal(partial.coverage, 0.6);
  assert.ok(Math.abs(partial.change - 0.2) < 1e-12);
  assert.equal(
    estimateChange(assets, (asset) => ({ NEW: 0.2 })[asset], flat),
    null,
  );
  assert.equal(
    estimateChange([], () => 0, flat),
    null,
  );
});
