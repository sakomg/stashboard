import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Holding } from '../../src/domain/types.ts';
import { loadConfig } from '../../src/lib/config.ts';
import { runCollection } from '../../src/services/collector.ts';
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
