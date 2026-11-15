import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withoutDepositReceipts, type ZerionPosition } from '../../src/sources/zerion.ts';

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
