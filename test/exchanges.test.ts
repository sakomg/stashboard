import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'stashboard-test-'));
process.env.DATA_DIR = dir;

const { finishSnapshot, listAccounts, openDb, removeAccount, resetHistory, saveOutcome, startSnapshot } =
  await import('../src/db.ts');
const { addExchange, exchangeHints, exchangeKeys, importConfigExchange } = await import('../src/exchanges.ts');
const { seal, unseal, vaultKey } = await import('../src/vault.ts');

const keys = { apiKey: 'A'.repeat(60) + 'wxyz', apiSecret: 'S'.repeat(64) };

test('secrets are sealed with a key file only the owner can read', () => {
  const key = vaultKey(dir);
  assert.equal(key.length, 32);
  assert.equal(statSync(join(dir, 'secret.key')).mode & 0o777, 0o600);
  const sealed = seal(key, keys);
  assert.ok(!sealed.includes(keys.apiSecret));
  assert.deepEqual(unseal(key, sealed), keys);

  const [iv, tag, data] = sealed.split('.');
  const flipped = Buffer.from(data!, 'base64url');
  flipped[0] = flipped[0]! ^ 1;
  assert.throws(() => unseal(key, [iv, tag, flipped.toString('base64url')].join('.')));
  assert.throws(() => unseal(Buffer.alloc(32, 7), sealed));
});

test('the key from config.json is imported once, onto the existing exchange account', () => {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  db.prepare(
    "INSERT INTO accounts (kind, label, address, address_key) VALUES ('binance', 'Binance', '', 'binance')",
  ).run();
  const legacy = listAccounts(db)[0]!;

  const imported = importConfigExchange(db, keys);
  assert.equal(imported?.id, legacy.id, 'history stays with the same account');
  assert.deepEqual(exchangeKeys(db, legacy.id), keys);
  assert.equal(exchangeHints(db).get(legacy.id), '…wxyz');

  assert.ok(removeAccount(db, legacy.id));
  assert.equal(exchangeKeys(db, legacy.id), null, 'the key goes with the account');
  assert.equal(importConfigExchange(db, keys), null, 'a removed exchange does not come back from config.json');
  assert.equal(listAccounts(db).length, 0);
});

test('the same API key cannot be added twice', () => {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  addExchange(db, 'binance', keys, 'Main');
  assert.throws(() => addExchange(db, 'binance', keys), /already added/);
  const other = addExchange(db, 'binance', { ...keys, apiKey: 'B'.repeat(64) });
  assert.equal(other.label, 'Binance');
  assert.equal(listAccounts(db).length, 2);
});

test('starting history over keeps the latest good read of every account', () => {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  const a = addExchange(db, 'binance', keys);
  const b = addExchange(db, 'binance', { ...keys, apiKey: 'C'.repeat(64) });
  const holding = {
    chain: 'binance',
    protocol: 'Spot',
    symbol: 'BTC',
    quantity: 1,
    price: 1,
    value: 1,
    type: 'wallet' as const,
  };
  const run = (outcomes: [number, boolean][]) => {
    const id = startSnapshot(db);
    for (const [account, ok] of outcomes) {
      saveOutcome(
        db,
        id,
        account,
        ok ? { status: 'ok', holdings: [holding], warnings: [] } : { status: 'error', error: 'down' },
      );
    }
    finishSnapshot(db, id);
    return id;
  };
  run([[a.id, true]]);
  const bLastGood = run([
    [a.id, true],
    [b.id, true],
  ]);
  run([
    [a.id, true],
    [b.id, false],
  ]);

  assert.equal(resetHistory(db), 1);
  const left = db.prepare('SELECT id FROM snapshots ORDER BY id').all() as { id: number }[];
  assert.equal(left[0]?.id, bLastGood);
  assert.equal(left.length, 2);
});
