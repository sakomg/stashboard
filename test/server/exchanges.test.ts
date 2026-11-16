import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { loadConfig } from '../../src/lib/config.ts';
import { createApp } from '../../src/server/app.ts';
import { createContext } from '../../src/server/context.ts';
import { ADMIN_ID, claimAdmin, createSession, listAccounts, openDb } from '../../src/storage/index.ts';

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
  const add = async (payload: Record<string, unknown>) => {
    const res = await app.inject({ method: 'POST', url: '/api/exchanges', headers: { cookie }, payload });
    return { status: res.statusCode, body: res.json() as { error?: string } };
  };
  return { db, add };
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
