import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isExchange, priceFrom, readWallets, toHoldings } from '../../src/domain/exchange.ts';

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

test('balances become holdings, a negative one a borrow, and the exchange value prices what has no market', () => {
  const { holdings, warnings } = toHoldings(
    'okx',
    [
      { wallet: 'Trading', type: 'wallet', asset: 'BTC', quantity: 0.5 },
      { wallet: 'Trading', type: 'wallet', asset: 'USDT', quantity: -100 },
      { wallet: 'Trading', type: 'wallet', asset: 'RARE', quantity: 4, usd: 10 },
      { wallet: 'Funding', type: 'wallet', asset: 'GONE', quantity: 3 },
      { wallet: 'Funding', type: 'wallet', asset: 'ZERO', quantity: 0 },
    ],
    tickers,
  );
  assert.deepEqual(
    holdings.map((h) => [h.symbol, h.type, h.price, h.value]),
    [
      ['BTC', 'wallet', 60000, 30000],
      ['USDT', 'borrow', 1, -100],
      ['RARE', 'wallet', 2.5, 10],
    ],
  );
  assert.equal(holdings[0]?.chain, 'okx');
  assert.equal(holdings[0]?.protocol, 'Trading');
  assert.deepEqual(warnings, ['no price for 3 GONE in Funding']);
});

test('a wallet that cannot be read becomes a warning and does not hide the others', async () => {
  const warnings: string[] = [];
  const balances = await readWallets(
    [
      ['Funding', async () => [{ wallet: 'Funding', type: 'wallet', asset: 'BTC', quantity: 1 }]],
      [
        'Earn',
        async () => {
          throw new Error('permission denied');
        },
      ],
    ],
    warnings,
  );
  assert.equal(balances.length, 1);
  assert.deepEqual(warnings, ['Earn could not be read: permission denied']);
});

test('only the listed exchanges are exchanges', () => {
  assert.ok(isExchange('binance'));
  assert.ok(isExchange('bybit'));
  assert.ok(isExchange('okx'));
  assert.ok(isExchange('gate'));
  assert.ok(!isExchange('evm'));
  assert.ok(!isExchange('toString'));
});
