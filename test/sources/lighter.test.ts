import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lighterHoldings } from '../../src/sources/lighter.ts';

test('a Lighter account is one holding worth its equity, in the stablecoin that backs it', () => {
  const holdings = lighterHoldings(
    [
      {
        total_asset_value: '429.218809',
        assets: [{ symbol: 'USDC', balance: '0.000000', margin_balance: '296.084395' }],
      },
    ],
    'ethereum',
    'USDC',
  );
  assert.deepEqual(holdings, [
    {
      chain: 'ethereum',
      protocol: 'Lighter',
      symbol: 'USDC',
      quantity: 429.218809,
      price: 1,
      value: 429.218809,
      type: 'futures',
    },
  ]);
});

test('an empty Lighter account adds nothing, and an unnamed collateral falls back to the venue default', () => {
  assert.deepEqual(lighterHoldings([{ total_asset_value: '0.000000' }, {}], 'robinhood', 'USDG'), []);
  assert.equal(lighterHoldings([{ total_asset_value: '12.5' }], 'robinhood', 'USDG')[0]?.symbol, 'USDG');
});
