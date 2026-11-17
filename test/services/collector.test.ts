import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Holding } from '../../src/domain/types.ts';
import { loadConfig } from '../../src/lib/config.ts';
import { repriceEarlierReads, runCollection, updateGate } from '../../src/services/collector.ts';
import { ADMIN_ID, addWallet, finishSnapshot, openDb, saveOutcome, startSnapshot } from '../../src/storage/index.ts';

const worth = (value: number): Holding => ({
  chain: 'ethereum',
  protocol: null,
  symbol: 'USDC',
  quantity: value,
  price: 1,
  value,
  type: 'wallet',
});

test('an update reads accounts from the largest balance down, the order the page lists them in', async () => {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  const small = addWallet(db, ADMIN_ID, `0x${'1'.repeat(40)}`, 'Small');
  const owing = addWallet(db, ADMIN_ID, `0x${'2'.repeat(40)}`, 'Owing');
  const large = addWallet(db, ADMIN_ID, `0x${'3'.repeat(40)}`, 'Large');
  const fresh = addWallet(db, ADMIN_ID, `0x${'4'.repeat(40)}`, 'Fresh');
  const snapshot = startSnapshot(db);
  saveOutcome(db, snapshot, small.id, { status: 'ok', holdings: [worth(100)], warnings: [] });
  saveOutcome(db, snapshot, owing.id, { status: 'ok', holdings: [worth(-50)], warnings: [] });
  saveOutcome(db, snapshot, large.id, { status: 'ok', holdings: [worth(5000)], warnings: [] });
  finishSnapshot(db, snapshot);

  const read: number[] = [];
  await runCollection(db, loadConfig('config.example.json'), (event) => {
    if (event.type === 'reading') read.push(event.accountId);
  });
  assert.deepEqual(read, [large.id, small.id, fresh.id, owing.id]);
});

test('adding an account reads only that account, and a removed one is skipped without a snapshot', async () => {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  const old = addWallet(db, ADMIN_ID, `0x${'1'.repeat(40)}`, 'Old');
  const added = addWallet(db, ADMIN_ID, `0x${'2'.repeat(40)}`, 'Added');
  const read: number[] = [];
  const run = await runCollection(
    db,
    loadConfig('config.example.json'),
    (event) => {
      if (event.type === 'reading') read.push(event.accountId);
    },
    { only: [added.id] },
  );
  assert.deepEqual(read, [added.id]);
  assert.deepEqual(
    (
      db.prepare('SELECT account_id FROM snapshot_accounts WHERE snapshot_id = ?').all(run) as { account_id: number }[]
    ).map((r) => r.account_id),
    [added.id],
  );
  assert.equal(await runCollection(db, loadConfig('config.example.json'), () => {}, { only: [old.id + 100] }), null);
});

test('positions from an earlier read take the price this run found for the same token', () => {
  const holding = (symbol: string, value: number, readAt: string | null, type: Holding['type'] = 'wallet') => ({
    chain: 'arbitrum',
    protocol: null,
    symbol,
    quantity: 2,
    price: Math.abs(value) / 2,
    value,
    type,
    readAt,
  });
  const earlier = '2026-01-01T00:00:00.000Z';
  const repriced = repriceEarlierReads([
    holding('ETH', 4000, null),
    holding('WETH', 3000, earlier, 'deposit'),
    holding('ETH', -3000, earlier, 'borrow'),
    holding('PONS', 10, earlier),
  ]);
  assert.deepEqual(
    repriced.map((h) => h.value),
    [4000, 4000, -4000, 10],
  );
});

test('updates are refused while one runs, until the planned gap has passed, or when Zerion has nothing left', () => {
  const now = Date.now();
  const base = {
    running: false,
    lastStartedAt: 0,
    gapMinutes: 15,
    zerionWallets: 2,
    zerionUsedUp: false,
    zerionRenewsAt: null,
    now,
  };
  assert.deepEqual(updateGate(base), { allowed: true, reason: null, availableAt: null });
  assert.equal(updateGate({ ...base, running: true }).allowed, false);

  const soon = updateGate({ ...base, lastStartedAt: now - 5 * 60_000 });
  assert.equal(soon.allowed, false);
  assert.equal(soon.availableAt, now + 10 * 60_000);
  assert.match(soon.reason ?? '', /one update every 15 min/);
  assert.equal(updateGate({ ...base, lastStartedAt: now - 15 * 60_000 }).allowed, true);

  const renews = now + 5 * 3_600_000;
  const usedUp = updateGate({ ...base, zerionUsedUp: true, zerionRenewsAt: renews });
  assert.equal(usedUp.allowed, false);
  assert.equal(usedUp.availableAt, renews);
  assert.match(usedUp.reason ?? '', /resume in about 5 h/);

  assert.equal(updateGate({ ...base, zerionWallets: 0, zerionUsedUp: true }).allowed, true);
  assert.equal(
    updateGate({ ...base, zerionWallets: 0, gapMinutes: 1, lastStartedAt: now - 20_000 }).reason,
    'Updated a moment ago',
  );
});
