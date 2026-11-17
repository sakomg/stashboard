import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'stashboard-test-'));
process.env.DATA_DIR = dir;

const { ADMIN_ID, listAccounts, openDb, removeAccount } = await import('../../src/storage/index.ts');
const { addExchange, bindingAdvice, exchangeHints, exchangeKeys } = await import('../../src/services/exchanges.ts');
const { seal, unseal, vaultKey } = await import('../../src/storage/vault.ts');

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

test('an exchange key is kept sealed, shown by its last characters, and removed with its account', () => {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  const account = addExchange(db, ADMIN_ID, 'binance', keys);
  assert.deepEqual(exchangeKeys(db, account.id), keys);
  assert.equal(exchangeHints(db).get(account.id), '…wxyz');
  const stored = db.prepare('SELECT sealed FROM exchange_keys').get() as { sealed: string };
  assert.ok(!stored.sealed.includes(keys.apiSecret));

  assert.ok(removeAccount(db, ADMIN_ID, account.id));
  assert.equal(exchangeKeys(db, account.id), null);
});

test('a key need not be bound to an IP address, except where the exchange turns an unbound one off', () => {
  assert.equal(bindingAdvice('binance', false, '203.0.113.7'), null);
  assert.equal(bindingAdvice('okx', false, null), null);
  assert.equal(bindingAdvice('bingx', false, '203.0.113.7'), null);
  assert.equal(bindingAdvice('bybit', true, '203.0.113.7'), null);
  assert.equal(
    bindingAdvice('bybit', false, '203.0.113.7'),
    "Bybit turns off a key that is not bound to an IP address after three months. Bind the key to this server's address, 203.0.113.7, to keep it working.",
  );
  assert.match(bindingAdvice('gate', false, null) ?? '', /90 days\. Bind the key to this server's IP address to keep/);
});

test('the same API key cannot be added twice', () => {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  addExchange(db, ADMIN_ID, 'binance', keys, 'Main');
  assert.throws(() => addExchange(db, ADMIN_ID, 'binance', keys), /already added/);
  const other = addExchange(db, ADMIN_ID, 'binance', { ...keys, apiKey: 'B'.repeat(64) });
  assert.equal(other.label, 'Binance');
  assert.equal(listAccounts(db, 'all').length, 2);
});
