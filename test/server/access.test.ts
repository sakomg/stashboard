import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { totpCode } from '../../src/auth/index.ts';
import { loadConfig } from '../../src/lib/config.ts';
import { createApp } from '../../src/server/app.ts';
import { createContext } from '../../src/server/context.ts';
import {
  ADMIN_ID,
  addUser,
  addWallet,
  claimAdmin,
  createSession,
  listAccounts,
  openDb,
} from '../../src/storage/index.ts';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'stashboard-test-'));
globalThis.fetch = (async () => {
  throw new Error('No network in these tests');
}) as typeof fetch;

const EVM = '0x52908400098527886E0F7030069857D2E4169EE7';

function server(env: NodeJS.ProcessEnv = {}, withOwner = false) {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  if (withOwner) claimAdmin(db, { name: 'admin', passwordHash: 'x', totpSecret: 'JBSWY3DPEHPK3PXP', totpStep: 0 });
  const ctx = createContext({ config: loadConfig('config.example.json'), db, env: { HOST: '0.0.0.0', ...env } });
  return { ...createApp(ctx), db };
}

const status = async (app: ReturnType<typeof server>['app'], url: string, headers: Record<string, string> = {}) => {
  const res = await app.inject({ method: 'GET', url, headers });
  return res.statusCode === 302 ? `302 ${res.headers.location}` : String(res.statusCode);
};

test('before the account exists, a reachable server serves only setup and what it needs', async () => {
  const { app } = server();
  assert.equal(await status(app, '/'), '302 /setup');
  assert.equal(await status(app, '/login'), '302 /setup');
  assert.equal(await status(app, '/setup'), '200');
  assert.equal(await status(app, '/setup/setup.js'), '200');
  assert.equal(await status(app, '/common/base.css'), '200');
  assert.equal(await status(app, '/dashboard/main.js'), '302 /setup');
  assert.equal(await status(app, '/api/portfolio'), '401');
});

test('with an account, everything but sign-in needs a session', async () => {
  const { app, db } = server({}, true);
  assert.equal(await status(app, '/'), '302 /login');
  assert.equal(await status(app, '/setup'), '302 /login');
  assert.equal(await status(app, '/login'), '200');
  assert.equal(await status(app, '/login/login.js'), '200');
  assert.equal(await status(app, '/dashboard/main.js'), '302 /login');
  assert.equal(await status(app, '/api/progress'), '401');

  const cookie = `stashboard_session=${createSession(db, ADMIN_ID, 60_000)}`;
  assert.equal(await status(app, '/', { cookie }), '200');
  assert.equal(await status(app, '/dashboard/main.js', { cookie }), '200');
  assert.equal(await status(app, '/api/progress', { cookie }), '200');
  assert.equal(await status(app, '/api/progress', { cookie: 'stashboard_session=forged' }), '401');
});

test('a shared link and its page open without a session, and nothing else does', async () => {
  const { app } = server({}, true);
  assert.equal(await status(app, '/s/AAAAAAAAAAAAAAAAAAAAAA'), '200');
  assert.equal(await status(app, '/share/share.js'), '200');
  assert.equal(await status(app, '/api/shared/AAAAAAAAAAAAAAAAAAAAAA'), '404');
  assert.equal(await status(app, '/logo/token/BTC'), '302 /login');
  assert.equal(await status(app, '/vendor/echarts.js'), '302 /login');
});

test('files are served from a fixed list, never by request path', async () => {
  const { app } = server({}, true);
  for (const url of ['/common/../../config.json', '/common/%2e%2e/%2e%2e/package.json', '/dashboard/../src/main.ts']) {
    assert.match(await status(app, url), /^(302 \/login|404)$/, url);
  }
});

test('a request that changes something must come from the same site', async () => {
  const { app } = server();
  const res = await app.inject({
    method: 'POST',
    url: '/api/setup/start',
    headers: { origin: 'https://evil.example', host: 'stash.example' },
    payload: {},
  });
  assert.equal(res.statusCode, 403);
});

test('every answer carries the security headers', async () => {
  const { app } = server();
  const res = await app.inject({ method: 'GET', url: '/setup' });
  assert.match(String(res.headers['content-security-policy']), /default-src 'self'/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
});

test('the demo refuses to change accounts or people, or collect', async () => {
  const { app } = server({ DEMO: '1', HOST: '127.0.0.1' });
  for (const [method, url] of [
    ['POST', '/api/wallets'],
    ['POST', '/api/exchanges'],
    ['POST', '/api/collect'],
    ['POST', '/api/invites'],
    ['POST', '/api/users/2/reset'],
    ['DELETE', '/api/accounts/1'],
    ['DELETE', '/api/users/2'],
    ['PATCH', '/api/me'],
  ] as const) {
    const res = await app.inject({ method, url, payload: {} });
    assert.equal(res.statusCode, 403, `${method} ${url}`);
  }
});

type App = ReturnType<typeof server>['app'];
const call = (app: App, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie?: string, payload?: object) =>
  app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(payload ? { payload } : {}) });
const sessionOf = (db: ReturnType<typeof openDb>, userId: number) =>
  `stashboard_session=${createSession(db, userId, 60_000)}`;
const cookieFrom = (res: { headers: Record<string, unknown> }) =>
  `stashboard_session=${/stashboard_session=([^;]+)/.exec(String(res.headers['set-cookie']))![1]}`;

test('a friend joins with an invite, signs in by name, and sees and changes only their own accounts', async () => {
  const { app, db } = server({}, true);
  const admin = sessionOf(db, ADMIN_ID);
  const mine = addWallet(db, ADMIN_ID, EVM, 'Main');
  const step = Math.floor(Date.now() / 30_000);

  const invite = (await call(app, 'POST', '/api/invites', admin, {})).json();
  assert.match(invite.token, /^[A-Za-z0-9_-]{32}$/);
  const pending = (await call(app, 'GET', '/api/invites', admin)).json();
  assert.deepEqual(
    pending.map((i: { token: string | null }) => i.token),
    [invite.token],
    'the admin can copy a pending link again',
  );
  assert.equal(await status(app, '/join'), '200');
  assert.equal(await status(app, '/join/join.js'), '200');

  const started = await call(app, 'POST', '/api/join/start', undefined, {
    token: invite.token,
    name: 'Kate',
    password: 'kate password 1',
  });
  assert.equal(started.statusCode, 200);
  const secret = started.json().key.replaceAll(' ', '');
  const joined = await call(app, 'POST', '/api/join/finish', undefined, {
    token: invite.token,
    code: totpCode(secret, step),
  });
  assert.equal(joined.statusCode, 200);
  const kate = cookieFrom(joined);

  const reused = await call(app, 'POST', '/api/join/start', undefined, {
    token: invite.token,
    name: 'Bob',
    password: 'bob password 12',
  });
  assert.equal(reused.statusCode, 401, 'an invite works once');

  const theirs = (await call(app, 'GET', '/api/portfolio', kate)).json();
  assert.deepEqual(theirs.sources, []);
  assert.deepEqual(theirs.me, { name: 'Kate', admin: false });
  assert.equal((await call(app, 'PATCH', `/api/accounts/${mine.id}`, kate, { label: 'Mine' })).statusCode, 404);
  assert.equal((await call(app, 'DELETE', `/api/accounts/${mine.id}`, kate)).statusCode, 404);
  assert.equal(listAccounts(db, ADMIN_ID)[0]?.label, 'Main');
  assert.equal((await call(app, 'POST', '/api/invites', kate, {})).statusCode, 403);
  assert.equal((await call(app, 'GET', '/api/invites', kate)).statusCode, 403);
  assert.equal((await call(app, 'GET', '/api/users', kate)).statusCode, 403);

  const own = (await call(app, 'GET', '/api/portfolio', admin)).json();
  assert.deepEqual(
    own.sources.map((s: { label: string }) => s.label),
    ['Main'],
  );
  assert.deepEqual(own.me, { name: 'admin', admin: true });

  const login = (name: string, code: string) =>
    call(app, 'POST', '/api/login', undefined, { name, password: 'kate password 1', code });
  assert.equal((await login('Kate', totpCode(secret, step))).statusCode, 401, 'the code used to join is spent');
  assert.equal((await login('Nobody', totpCode(secret, step + 1))).statusCode, 401);
  assert.equal((await login(' KATE ', totpCode(secret, step + 1))).statusCode, 200);
});

test('a friend who lost their sign-in sets a new one from a reset link, and their old sessions end', async () => {
  const { app, db } = server({}, true);
  const friend = addUser(db, { name: 'Kate', passwordHash: 'h', totpSecret: 'S', totpStep: 0 });
  addWallet(db, friend.id, EVM);
  const admin = sessionOf(db, ADMIN_ID);
  const oldKate = sessionOf(db, friend.id);
  const step = Math.floor(Date.now() / 30_000);

  assert.equal((await call(app, 'POST', `/api/users/${friend.id}/reset`, oldKate, {})).statusCode, 403);
  assert.equal((await call(app, 'POST', `/api/users/${ADMIN_ID}/reset`, admin, {})).statusCode, 404);
  assert.equal((await call(app, 'POST', '/api/users/99/reset', admin, {})).statusCode, 404);
  const reset = (await call(app, 'POST', `/api/users/${friend.id}/reset`, admin, {})).json();
  assert.equal(reset.person, 'Kate');
  const pending = (await call(app, 'GET', '/api/invites', admin)).json();
  assert.deepEqual(
    pending.map((i: { token: string; person: string }) => [i.token, i.person]),
    [[reset.token, 'Kate']],
  );
  assert.equal(await status(app, '/reset'), '200');
  assert.equal(await status(app, '/reset/reset.js'), '200');

  const joining = await call(app, 'POST', '/api/join/start', undefined, {
    token: reset.token,
    name: 'Bob',
    password: 'bob password 12',
  });
  assert.equal(joining.statusCode, 401, 'a reset link lets nobody new in');
  assert.equal(
    (await call(app, 'POST', '/api/reset/start', undefined, { token: reset.token, password: 'short' })).statusCode,
    400,
  );
  const started = await call(app, 'POST', '/api/reset/start', undefined, {
    token: reset.token,
    password: 'kate new password',
  });
  assert.equal(started.statusCode, 200);
  assert.equal(started.json().name, 'Kate');
  const secret = started.json().key.replaceAll(' ', '');
  assert.equal(
    (await call(app, 'POST', '/api/reset/finish', undefined, { token: reset.token, code: '000000' })).statusCode,
    401,
  );
  const done = await call(app, 'POST', '/api/reset/finish', undefined, {
    token: reset.token,
    code: totpCode(secret, step),
  });
  assert.equal(done.statusCode, 200);
  const kate = cookieFrom(done);

  assert.equal((await call(app, 'GET', '/api/progress', oldKate)).statusCode, 401, 'old sessions end');
  assert.equal((await call(app, 'GET', '/api/portfolio', kate)).json().sources.length, 1, 'accounts stay');
  assert.equal((await call(app, 'GET', '/api/progress', admin)).statusCode, 200);
  assert.deepEqual((await call(app, 'GET', '/api/invites', admin)).json(), []);
  const again = await call(app, 'POST', '/api/reset/start', undefined, {
    token: reset.token,
    password: 'someone else 12',
  });
  assert.equal(again.statusCode, 401, 'a reset link works once');

  const login = (password: string, code: string) =>
    call(app, 'POST', '/api/login', undefined, { name: 'Kate', password, code });
  assert.equal((await login('kate new password', totpCode(secret, step))).statusCode, 401, 'the code is spent');
  assert.equal((await login('kate password 1', totpCode(secret, step + 1))).statusCode, 401);
  assert.equal((await login('kate new password', totpCode(secret, step + 1))).statusCode, 200);
});

test('the admin renames themselves, lists people and removes a friend with all they had, but not themselves', async () => {
  const { app, db } = server({}, true);
  const friend = addUser(db, { name: 'Kate', passwordHash: 'h', totpSecret: 'S', totpStep: 0 });
  addWallet(db, friend.id, EVM);
  const admin = sessionOf(db, ADMIN_ID);
  const kate = sessionOf(db, friend.id);

  const people = (await call(app, 'GET', '/api/users', admin)).json();
  assert.deepEqual(
    people.map((p: { name: string; admin: boolean; you: boolean; accounts: number }) => [
      p.name,
      p.admin,
      p.you,
      p.accounts,
    ]),
    [
      ['admin', true, true, 0],
      ['Kate', false, false, 1],
    ],
  );
  assert.equal((await call(app, 'PATCH', '/api/me', admin, { name: 'kate' })).statusCode, 400, 'the name is taken');
  assert.equal((await call(app, 'PATCH', '/api/me', admin, { name: ' Alexander ' })).statusCode, 200);
  assert.deepEqual((await call(app, 'GET', '/api/portfolio', admin)).json().me, { name: 'Alexander', admin: true });
  assert.equal((await call(app, 'DELETE', `/api/users/${ADMIN_ID}`, admin)).statusCode, 404);
  assert.equal((await call(app, 'DELETE', `/api/users/${friend.id}`, admin)).statusCode, 200);
  assert.equal((await call(app, 'GET', '/api/progress', kate)).statusCode, 401);
  assert.equal(listAccounts(db, 'all').length, 0);
});

test('on this machine alone, without sign-in, the dashboard is the admin’s and nobody can be invited yet', async () => {
  const { app } = server({ HOST: '127.0.0.1' });
  const view = (await call(app, 'GET', '/api/portfolio')).json();
  assert.deepEqual(view.me, { name: 'admin', admin: true });
  assert.equal(view.loginEnabled, false);
  assert.equal((await call(app, 'POST', '/api/invites', undefined, {})).statusCode, 409);
  assert.equal(await status(app, '/join'), '302 /setup');
});

test('the page learns which exchanges turn off an unbound key, and no server address on this machine alone', async () => {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  const config = { ...loadConfig('config.example.json'), domain: 'stash.example.com' };
  const { app } = createApp(createContext({ config, db, env: { HOST: '127.0.0.1' } }));
  const view = (await call(app, 'GET', '/api/portfolio')).json();
  assert.equal(view.serverAddress, null);
  assert.deepEqual(
    Object.entries(view.ipRequired)
      .filter(([, reason]) => reason)
      .map(([kind]) => kind),
    ['bybit', 'gate'],
  );
});

test('dismissing an overheated asset takes a list of asset names', async () => {
  const { app, db } = server({}, true);
  const admin = sessionOf(db, ADMIN_ID);
  for (const payload of [{}, { assets: [] }, { assets: 'ETH' }, { assets: [1] }, { assets: [''] }]) {
    assert.equal((await call(app, 'POST', '/api/heat/dismiss', admin, payload)).statusCode, 400);
  }
  const done = await call(app, 'POST', '/api/heat/dismiss', admin, { assets: ['ETH'] });
  assert.equal(done.statusCode, 200);
  assert.deepEqual(done.json(), { dismissed: [] });
  assert.equal((await call(app, 'POST', '/api/heat/dismiss', undefined, { assets: ['ETH'] })).statusCode, 401);
});
