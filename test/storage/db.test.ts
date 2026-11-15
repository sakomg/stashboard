import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  addWallet,
  currentState,
  finishSnapshot,
  listWallets,
  openDb,
  removeWallet,
  saveOutcome,
  startSnapshot,
} from '../../src/storage/index.ts';
import type { Holding } from '../../src/domain/types.ts';

const freshDb = () => openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
const EVM = '0x52908400098527886E0F7030069857D2E4169EE7';
const eth: Holding = {
  chain: 'ethereum',
  protocol: null,
  symbol: 'ETH',
  quantity: 1,
  price: 2000,
  value: 2000,
  type: 'wallet',
};

test('a wallet cannot be added twice', () => {
  const db = freshDb();
  addWallet(db, EVM, 'main');
  assert.throws(() => addWallet(db, EVM.toLowerCase()), /already added/);
  assert.equal(listWallets(db).length, 1);
});

test('a failed collection keeps the last good holdings and marks them stale', () => {
  const db = freshDb();
  const wallet = addWallet(db, EVM);

  const first = startSnapshot(db);
  saveOutcome(db, first, wallet.id, { status: 'ok', holdings: [eth], warnings: [] });
  finishSnapshot(db, first);
  let [state] = currentState(db);
  assert.equal(state!.stale, false);
  assert.equal(state!.holdings.length, 1);

  const second = startSnapshot(db);
  saveOutcome(db, second, wallet.id, { status: 'error', error: 'boom' });
  finishSnapshot(db, second);
  [state] = currentState(db);
  assert.equal(state!.stale, true);
  assert.equal(state!.lastError, 'boom');
  assert.equal(state!.holdings[0]!.value, 2000);
});

test('removing a wallet removes its history', () => {
  const db = freshDb();
  const wallet = addWallet(db, EVM);
  const snapshot = startSnapshot(db);
  saveOutcome(db, snapshot, wallet.id, { status: 'ok', holdings: [eth], warnings: [] });
  assert.equal(removeWallet(db, wallet.id), true);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM holdings').get() as { n: number }).n, 0);
  assert.equal(currentState(db).length, 0);
});
