import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountsMessage, heatMessage } from '../../src/domain/notices.ts';

test('a heat message names the assets, largest first, with their share of the portfolio', () => {
  assert.deepEqual(heatMessage('overheated', [{ key: 'BONK', score: 89.4, share: 0.018 }]), {
    title: 'BONK is overheated',
    body: 'Heat 89. 1.8% of the portfolio.',
    tag: 'heat-overheated',
  });
  assert.deepEqual(
    heatMessage('cold', [
      { key: 'ETH', score: 25, share: 0.1 },
      { key: 'SOL', score: 22, share: 0.2 },
    ]),
    { title: 'SOL and ETH are cold', body: '30.0% of the portfolio.', tag: 'heat-cold' },
  );
  const many = ['A', 'B', 'C', 'D', 'E'].map((key, i) => ({ key, score: 85, share: 0.05 - i * 0.01 }));
  assert.equal(heatMessage('overheated', many).title, 'A, B, C and 2 more are overheated');
  assert.equal(heatMessage('overheated', many.slice(0, 4)).title, 'A, B, C and D are overheated');
});

test('an account message gives the reason for one account and the names for several', () => {
  assert.deepEqual(accountsMessage([{ label: 'Bybit', error: 'Bybit refused the key: it has expired.' }]), {
    title: 'Bybit is out of date',
    body: 'Bybit refused the key: it has expired.',
    tag: 'accounts',
  });
  assert.deepEqual(
    accountsMessage([
      { label: 'Bybit', error: 'x' },
      { label: 'Ledger', error: null },
    ]),
    { title: '2 accounts are out of date', body: 'Bybit and Ledger.', tag: 'accounts' },
  );
});
