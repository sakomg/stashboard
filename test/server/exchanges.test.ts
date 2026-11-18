import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { loadConfig } from '../../src/lib/config.ts';
import { createApp } from '../../src/server/app.ts';
import { createContext } from '../../src/server/context.ts';
import { exchangeKeys } from '../../src/services/exchanges.ts';
import {
  ADMIN_ID,
  addUser,
  addWallet,
  claimAdmin,
  createSession,
  finishSnapshot,
  listAccounts,
  openDb,
  saveOutcome,
  startSnapshot,
} from '../../src/storage/index.ts';

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

function signedIn() {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  claimAdmin(db, { name: 'admin', passwordHash: 'x', totpSecret: 'JBSWY3DPEHPK3PXP', totpStep: 0 });
  const ctx = createContext({ config: loadConfig('config.example.json'), db, env: { HOST: '0.0.0.0' } });
  const { app } = createApp(ctx);
  const cookie = `stashboard_session=${createSession(db, ADMIN_ID, 60_000)}`;
  const add = async (payload: Record<string, unknown>, session = cookie) => {
    const res = await app.inject({ method: 'POST', url: '/api/exchanges', headers: { cookie: session }, payload });
    return { status: res.statusCode, body: res.json() as { id?: number; error?: string; warning?: string | null } };
  };
  const replace = async (id: number, payload: Record<string, unknown>, session = cookie) => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/accounts/${id}/key`,
      headers: { cookie: session },
      payload,
    });
    return { status: res.statusCode, body: res.json() as { error?: string; warning?: string | null } };
  };
  return { db, add, replace };
}

const okx = { apiKey: '37c541a1-1234-4abc-9def-10fe7a038418', apiSecret: '22582BD0CFF14C41EDBF1AB98506286D' };

test('only a listed exchange can be added, and OKX needs its passphrase', async () => {
  const { add } = signedIn();
  assert.deepEqual(await add({ exchange: 'toString', ...okx }), { status: 400, body: { error: 'Choose an exchange' } });
  assert.match((await add({ exchange: 'okx', ...okx })).body.error ?? '', /passphrase/);
  assert.match((await add({ exchange: 'bybit', apiKey: 'short', apiSecret: 'x' })).body.error ?? '', /exactly as/);
});

test('a key that can do more than read is refused with what to tick on that exchange, and nothing is stored', async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ code: '0', msg: '', data: [{ perm: 'read_only,trade', ip: '' }] }), {
      status: 200,
    })) as typeof fetch;
  const { db, add } = signedIn();
  const { status, body } = await add({ exchange: 'okx', ...okx, passphrase: 'Read only 1!' });
  assert.equal(status, 400);
  assert.equal(body.error, 'This key can do more than read: trading. Create a key with only the Read permission.');
  assert.equal(listAccounts(db, 'all').length, 0);
});

const okxAnswer = (perm: string) =>
  (async () =>
    new Response(JSON.stringify({ code: '0', msg: '', data: [{ perm, ip: '' }] }), { status: 200 })) as typeof fetch;

test('a new key replaces the old one and keeps the history, once it is checked to only read', async () => {
  globalThis.fetch = okxAnswer('read_only');
  const { db, add, replace } = signedIn();
  const { body } = await add({ exchange: 'okx', ...okx, passphrase: 'Read only 1!' });
  const id = body.id!;
  const snapshot = startSnapshot(db);
  saveOutcome(db, snapshot, id, { status: 'error', error: 'OKX refused the key' });
  finishSnapshot(db, snapshot);

  const fresh = { apiKey: '5f1d2c3b-4a59-4e6d-8c7b-9a0b1c2d3e4f', apiSecret: 'A1B2C3D4E5F60718293A4B5C6D7E8F90' };
  globalThis.fetch = okxAnswer('read_only,withdraw');
  const refused = await replace(id, { ...fresh, passphrase: 'New one 2!' });
  assert.equal(refused.status, 400);
  assert.match(refused.body.error ?? '', /can do more than read/);
  assert.equal(exchangeKeys(db, id)?.apiKey, okx.apiKey);

  assert.match((await replace(id, fresh)).body.error ?? '', /passphrase/);

  globalThis.fetch = okxAnswer('read_only');
  assert.deepEqual(await replace(id, { ...fresh, passphrase: 'New one 2!' }), {
    status: 200,
    body: { warning: null },
  });
  assert.equal(exchangeKeys(db, id)?.apiKey, fresh.apiKey);
  assert.equal(exchangeKeys(db, id)?.passphrase, 'New one 2!');
  const [account] = listAccounts(db, 'all');
  assert.equal(account?.id, id);
  const kept = db
    .prepare('SELECT status FROM snapshot_accounts WHERE account_id = ? AND snapshot_id = ?')
    .get(id, snapshot) as { status: string } | undefined;
  assert.equal(kept?.status, 'error');
});

test('a key already added cannot replace another, and only your own exchange takes a new key', async () => {
  globalThis.fetch = okxAnswer('read_only');
  const { db, add, replace } = signedIn();
  const first = (await add({ exchange: 'okx', ...okx, passphrase: 'Read only 1!' })).body.id!;
  const other = { apiKey: '5f1d2c3b-4a59-4e6d-8c7b-9a0b1c2d3e4f', apiSecret: 'A1B2C3D4E5F60718293A4B5C6D7E8F90' };
  const second = (await add({ exchange: 'okx', ...other, passphrase: 'Read only 1!' })).body.id!;

  assert.deepEqual(await replace(second, { ...okx, passphrase: 'Read only 1!' }), {
    status: 400,
    body: { error: 'This API key is already added' },
  });
  assert.equal(exchangeKeys(db, second)?.apiKey, other.apiKey);
  assert.equal((await replace(first, { ...okx, passphrase: 'Read only 1!' })).status, 200);

  const wallet = addWallet(db, ADMIN_ID, '0x52908400098527886E0F7030069857D2E4169EE7');
  assert.equal((await replace(wallet.id, { ...okx, passphrase: 'Read only 1!' })).status, 404);

  const kate = addUser(db, { name: 'Kate', passwordHash: 'h', totpSecret: 'S', totpStep: 0 });
  const theirs = `stashboard_session=${createSession(db, kate.id, 60_000)}`;
  assert.equal((await replace(first, { ...okx, passphrase: 'Read only 1!' }, theirs)).status, 404);
  assert.equal(exchangeKeys(db, first)?.apiKey, okx.apiKey);
});
