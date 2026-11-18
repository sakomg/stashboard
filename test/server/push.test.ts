import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { loadConfig } from '../../src/lib/config.ts';
import { createApp } from '../../src/server/app.ts';
import { createContext } from '../../src/server/context.ts';
import { ADMIN_ID, addUser, claimAdmin, createSession, openDb, subscriptionsOf } from '../../src/storage/index.ts';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'stashboard-test-'));
const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

const subscription = {
  endpoint: 'https://web.push.apple.com/QGxdevice',
  expirationTime: null,
  keys: {
    p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  },
};

function signedIn() {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  claimAdmin(db, { name: 'admin', passwordHash: 'x', totpSecret: 'JBSWY3DPEHPK3PXP', totpStep: 0 });
  const kate = addUser(db, { name: 'Kate', passwordHash: 'h', totpSecret: 'S', totpStep: 0 });
  const ctx = createContext({ config: loadConfig('config.example.json'), db, env: { HOST: '0.0.0.0' } });
  const { app } = createApp(ctx);
  const as = (userId: number) => ({ cookie: `stashboard_session=${createSession(db, userId, 60_000)}` });
  const call = (method: 'POST' | 'DELETE', payload: object, userId = ADMIN_ID) =>
    app.inject({ method, url: '/api/push', headers: as(userId), payload });
  return { db, app, as, call, kate };
}

test('a device subscribes with a welcome push, and the page learns the key to subscribe with', async () => {
  const pushed: string[] = [];
  globalThis.fetch = (async (url: string) => {
    pushed.push(url);
    return new Response('', { status: 201 });
  }) as typeof fetch;
  const { db, app, as, call } = signedIn();
  const page = (await app.inject({ method: 'GET', url: '/api/portfolio', headers: as(ADMIN_ID) })).json() as {
    pushKey: string;
  };
  assert.equal(Buffer.from(page.pushKey, 'base64url').length, 65);

  pushed.length = 0;
  assert.equal((await call('POST', subscription)).statusCode, 200);
  assert.deepEqual(pushed, [subscription.endpoint]);
  assert.equal(subscriptionsOf(db, ADMIN_ID).length, 1);
});

test('a subscription to anything but a browser push service is refused without a request', async () => {
  globalThis.fetch = (async () => assert.fail('nothing may be sent')) as typeof fetch;
  const { db, call } = signedIn();
  for (const endpoint of ['http://127.0.0.1:8787/api/collect', 'https://example.com/push']) {
    const res = await call('POST', { ...subscription, endpoint });
    assert.equal(res.statusCode, 400, endpoint);
  }
  assert.equal((await call('POST', { endpoint: subscription.endpoint, keys: 'x' })).statusCode, 400);
  assert.deepEqual(subscriptionsOf(db, ADMIN_ID), []);
});

test('a welcome push that fails leaves nothing subscribed', async () => {
  globalThis.fetch = (async () => new Response('', { status: 410 })) as typeof fetch;
  const { db, call } = signedIn();
  const res = await call('POST', subscription);
  assert.equal(res.statusCode, 502);
  assert.match((res.json() as { error: string }).error, /turned notifications down/);
  assert.deepEqual(subscriptionsOf(db, ADMIN_ID), []);
});

test('each person turns off only their own device', async () => {
  globalThis.fetch = (async () => new Response('', { status: 201 })) as typeof fetch;
  const { db, call, kate } = signedIn();
  await call('POST', subscription);
  assert.equal((await call('DELETE', { endpoint: subscription.endpoint }, kate.id)).statusCode, 404);
  assert.equal(subscriptionsOf(db, ADMIN_ID).length, 1);
  assert.equal((await call('DELETE', { endpoint: subscription.endpoint })).statusCode, 200);
  assert.deepEqual(subscriptionsOf(db, ADMIN_ID), []);
});
