import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import {
  ADMIN_ID,
  addWallet,
  currentState,
  finishSnapshot,
  listWallets,
  migrate,
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
  addWallet(db, ADMIN_ID, EVM, 'main');
  assert.throws(() => addWallet(db, ADMIN_ID, EVM.toLowerCase()), /already added/);
  assert.equal(listWallets(db, ADMIN_ID).length, 1);
});

test('a failed collection keeps the last good holdings and marks them stale', () => {
  const db = freshDb();
  const wallet = addWallet(db, ADMIN_ID, EVM);

  const first = startSnapshot(db);
  saveOutcome(db, first, wallet.id, { status: 'ok', holdings: [eth], warnings: [] });
  finishSnapshot(db, first);
  let [state] = currentState(db, ADMIN_ID);
  assert.equal(state!.stale, false);
  assert.equal(state!.holdings.length, 1);

  const second = startSnapshot(db);
  saveOutcome(db, second, wallet.id, { status: 'error', error: 'boom' });
  finishSnapshot(db, second);
  [state] = currentState(db, ADMIN_ID);
  assert.equal(state!.stale, true);
  assert.equal(state!.lastError, 'boom');
  assert.equal(state!.holdings[0]!.value, 2000);
});

test('removing a wallet removes its history', () => {
  const db = freshDb();
  const wallet = addWallet(db, ADMIN_ID, EVM);
  const snapshot = startSnapshot(db);
  saveOutcome(db, snapshot, wallet.id, { status: 'ok', holdings: [eth], warnings: [] });
  assert.equal(removeWallet(db, ADMIN_ID, wallet.id), true);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM holdings').get() as { n: number }).n, 0);
  assert.equal(currentState(db, ADMIN_ID).length, 0);
});

test('history drops the Lighter deposit Zerion reported next to the one read from Lighter itself', () => {
  const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), 'stashboard-test-')), 'stashboard.db'));
  migrate(db, 11);
  db.exec(`
    INSERT INTO accounts (id, user_id, kind, label, address, address_key) VALUES (1, 1, 'evm', 'Main', '0xabc', '0xabc');
    INSERT INTO snapshots (id, started_at, finished_at) VALUES (1, '2026-11-15', '2026-11-15'), (2, '2026-11-16', '2026-11-16');
    INSERT INTO snapshot_accounts (snapshot_id, account_id, status) VALUES (1, 1, 'ok'), (2, 1, 'ok');
    INSERT INTO holdings (snapshot_id, account_id, chain, protocol, symbol, type, quantity, value_usd) VALUES
      (1, 1, 'ethereum', 'lighter', 'USDC', 'deposit', 450, 450),
      (1, 1, 'ethereum', 'Lighter', 'USDC', 'futures', 449, 449),
      (1, 1, 'ethereum', NULL, 'ETH', 'wallet', 1, 3000),
      (2, 1, 'ethereum', 'lighter', 'USDC', 'deposit', 450, 450);
  `);

  migrate(db);

  assert.deepEqual(
    db
      .prepare('SELECT snapshot_id, protocol, value_usd FROM holdings ORDER BY id')
      .all()
      .map((r) => ({ ...r })),
    [
      { snapshot_id: 1, protocol: 'Lighter', value_usd: 449 },
      { snapshot_id: 1, protocol: null, value_usd: 3000 },
      { snapshot_id: 2, protocol: 'lighter', value_usd: 450 },
    ],
  );
});
