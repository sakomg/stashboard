import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asterHoldings, asterPrices, isMissingAccount } from '../../src/sources/aster.ts';

const prices = new Map([
  ['USDT', 1],
  ['ASTER', 0.5],
  ['RTX', 0.08],
]);

test('a public Aster account gives its futures collateral with unrealised PnL, spot balances and staking', () => {
  const { holdings, warnings } = asterHoldings(
    {
      accountPrivacy: 'disabled',
      perpAssets: [
        { asset: 'ASTER', walletBalance: 20 },
        { asset: 'USDT', walletBalance: 600 },
      ],
      spotAssets: [{ asset: 'RTX', walletBalance: 0.5 }],
      positions: [{ tradingProduct: 'perps', positions: [{ unrealizedProfit: '12.5' }, { unrealizedProfit: '-2.5' }] }],
      staking: { totalStakedAmount: '100', totalPendingStakeAmount: null, totalPendingUnstakeAmount: '10' },
    },
    prices,
  );
  assert.deepEqual(warnings, []);
  assert.deepEqual(
    holdings.map((h) => [h.chain, h.protocol, h.type, h.symbol, h.quantity, h.value]),
    [
      ['aster', 'Aster', 'futures', 'ASTER', 20, 10],
      ['aster', 'Aster', 'futures', 'USDT', 610, 610],
      ['aster', 'Aster', 'wallet', 'RTX', 0.5, 0.04],
      ['aster', 'Aster', 'staked', 'ASTER', 110, 55],
    ],
  );
});

test('an account in privacy mode, or one that does not exist, adds nothing', () => {
  assert.deepEqual(
    asterHoldings({ accountPrivacy: 'enabled', perpAssets: [{ asset: 'USDT', walletBalance: 100 }] }, prices),
    { holdings: [], warnings: [] },
  );
  assert.deepEqual(asterHoldings({}, prices), { holdings: [], warnings: [] });
});

test('an asset without a price is counted in a warning, and losses past the collateral are a debt', () => {
  const { holdings, warnings } = asterHoldings(
    {
      accountPrivacy: 'disabled',
      perpAssets: [{ asset: 'USDT', walletBalance: 5 }],
      spotAssets: [{ asset: 'NEW', walletBalance: 3 }],
      positions: [{ tradingProduct: 'perps', positions: [{ unrealizedProfit: '-8' }] }],
    },
    prices,
  );
  assert.deepEqual(warnings, ['1 Aster assets without a price skipped']);
  assert.deepEqual(
    holdings.map((h) => [h.type, h.symbol, h.value]),
    [['borrow', 'USDT', -3]],
  );
});

test('prices come from spot first, through USDT or USD1, and futures only fill the gaps', () => {
  const found = asterPrices(
    [
      { symbol: 'USD1USDT', price: '0.999' },
      { symbol: 'RTXUSD1', price: '0.07' },
      { symbol: 'ASTERUSDT', price: '0.56' },
    ],
    [
      { symbol: 'RTXUSDT', price: '0.22' },
      { symbol: 'ASTERUSDT', price: '0.57' },
      { symbol: 'AIUSDT', price: '0.02' },
    ],
  );
  assert.equal(found.get('USDT'), 1);
  assert.equal(found.get('ASTER'), 0.56);
  assert.ok(Math.abs(found.get('RTX')! - 0.07 * 0.999) < 1e-12);
  assert.equal(found.get('AI'), 0.02);
});

test('an address that never opened an account on Aster is no account, not a failure', () => {
  assert.ok(isMissingAccount({ message: 'The account does not exist, please open a futures account.' }));
  assert.equal(isMissingAccount({ message: 'Internal error' }), false);
  assert.equal(isMissingAccount({}), false);
});
