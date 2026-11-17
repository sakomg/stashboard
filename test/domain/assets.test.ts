import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createResolver, loadAssetRules } from '../../src/domain/assets.ts';
import { buildPortfolio } from '../../src/domain/portfolio.ts';
import type { AccountState } from '../../src/storage/index.ts';
import type { Holding } from '../../src/domain/types.ts';

const resolve = createResolver(loadAssetRules());

test('wrappers resolve to the canonical asset', () => {
  assert.deepEqual(resolve('WETH'), { key: 'ETH', category: 'ETH' });
  assert.deepEqual(resolve('cbBTC'), { key: 'BTC', category: 'BTC' });
  assert.deepEqual(resolve('USD₮'), { key: 'USDT', category: 'Stablecoins' });
});

test('TON, the coin renamed GRAM in 2026, counts as GRAM, and so do its staking receipts', () => {
  for (const symbol of ['GRAM', 'TON', 'tsTON', 'stTON']) {
    assert.deepEqual(resolve(symbol), { key: 'GRAM', category: 'L1' });
  }
});

test('Aave deposit receipts count as the token that was lent', () => {
  assert.deepEqual(resolve('aEthWETH'), { key: 'ETH', category: 'ETH' });
  assert.deepEqual(resolve('aEthWBTC'), { key: 'BTC', category: 'BTC' });
  assert.deepEqual(resolve('aArbUSDC'), { key: 'USDC', category: 'Stablecoins' });
  assert.deepEqual(resolve('aBaswstETH'), { key: 'ETH', category: 'ETH' });
  assert.deepEqual(resolve('aEthLidoWETH'), { key: 'ETH', category: 'ETH' });
  assert.equal(resolve('aEthX').key, 'aEthX');
  assert.equal(resolve('ARB').key, 'ARB');
  assert.equal(resolve('aArb').key, 'aArb');
});

test('tokenized stocks resolve to the ticker', () => {
  for (const symbol of ['NVDA', 'NVDAx', 'NVDAB', 'NVDAon']) {
    assert.deepEqual(resolve(symbol), { key: 'NVDA', category: 'Stocks' });
  }
});

test('lookalikes stay separate', () => {
  assert.equal(resolve('LDO').key, 'LDO');
  assert.equal(resolve('W').key, 'W');
  assert.deepEqual(resolve('SOMETHING'), { key: 'SOMETHING', category: 'Other' });
});

test('portfolio merges holdings and nets debts', () => {
  const holding = (symbol: string, quantity: number, price: number, type: Holding['type'] = 'wallet'): Holding => ({
    chain: 'test',
    protocol: null,
    symbol,
    quantity,
    price,
    value: quantity * price,
    type,
  });
  const state = (holdings: Holding[]): AccountState => ({
    account: { id: 1, kind: 'evm', label: 'a', address: '0x' },
    lastStatus: 'ok',
    lastError: null,
    collectedAt: null,
    stale: false,
    warnings: [],
    reportedTotal: null,
    holdings,
  });

  const { netWorth, assets } = buildPortfolio(
    [state([holding('ETH', 1, 2000), holding('WETH', 0.5, 2000)]), state([holding('USDC', -500, 1, 'borrow')])],
    resolve,
  );
  assert.equal(netWorth, 2500);
  assert.deepEqual(
    assets.map((a) => [a.key, a.value]),
    [
      ['ETH', 3000],
      ['USDC', -500],
    ],
  );
  assert.equal(assets[0]!.quantity, 1.5);
  assert.equal(assets[0]!.price, 2000);
});
