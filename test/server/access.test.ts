import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { hashPassword, totpCode } from '../../src/auth/index.ts';
import { loadConfig } from '../../src/lib/config.ts';
import { createApp } from '../../src/server/app.ts';
import { createContext } from '../../src/server/context.ts';
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

test('while an update runs, asking for another is refused until it ends', async () => {
  const { app, db } = server({}, true);
  addWallet(db, ADMIN_ID, `0:${'a'.repeat(64)}`, 'TON');
  const cookie = `stashboard_session=${createSession(db, ADMIN_ID, 60_000)}`;
  const noNetwork = globalThis.fetch;
  let answer: (res: Response) => void = () => {};
  globalThis.fetch = (() => new Promise<Response>((resolve) => (answer = resolve))) as typeof fetch;
  try {
    const first = Promise.resolve(
      app.inject({ method: 'POST', url: '/api/collect', headers: { cookie }, payload: {} }),
    );
    const running = async () =>
      (await app.inject({ method: 'GET', url: '/api/progress', headers: { cookie } })).json().collecting;
    for (let tries = 0; !(await running()); tries++) {
      assert.ok(tries < 100, 'the update never started');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const second = await app.inject({ method: 'POST', url: '/api/collect', headers: { cookie }, payload: {} });
    assert.equal(second.statusCode, 429);
    assert.equal(second.json().error, 'An update is running');
    answer(new Response('{}', { status: 500 }));
    assert.equal((await first).statusCode, 200);
    const progress = (await app.inject({ method: 'GET', url: '/api/progress', headers: { cookie } })).json();
    assert.equal(progress.collecting, false);
  } finally {
    globalThis.fetch = noNetwork;
  }
});

test('an update ends for each person once their own accounts are saved, while others are still read', async () => {
  const { app, db } = server({}, true);
  const kate = addUser(db, { name: 'Kate', passwordHash: 'h', totpSecret: 'S', totpStep: 0 });
  addWallet(db, ADMIN_ID, EVM, 'Mine');
  addWallet(db, kate.id, `0:${'b'.repeat(64)}`, 'Kate TON');
  const mine = `stashboard_session=${createSession(db, ADMIN_ID, 60_000)}`;
  const theirs = `stashboard_session=${createSession(db, kate.id, 60_000)}`;
  const noNetwork = globalThis.fetch;
  let answer: (res: Response) => void = () => {};
  globalThis.fetch = (() => new Promise<Response>((resolve) => (answer = resolve))) as typeof fetch;
  const collecting = async (cookie: string) =>
    (await app.inject({ method: 'GET', url: '/api/progress', headers: { cookie } })).json().collecting;
  try {
    const update = await app.inject({ method: 'POST', url: '/api/collect', headers: { cookie: mine }, payload: {} });
    assert.equal(update.statusCode, 200, 'my update answers while Kate’s wallet is still being read');
    assert.equal(await collecting(mine), false);
    assert.equal(await collecting(theirs), true);
    const portfolio = (await app.inject({ method: 'GET', url: '/api/portfolio', headers: { cookie: mine } })).json();
    assert.equal(portfolio.collecting, false);
    assert.equal(portfolio.sources[0].status, 'error', 'my wallet is saved: no Zerion key in this config');
    answer(new Response('{}', { status: 500 }));
    for (let tries = 0; await collecting(theirs); tries++) {
      assert.ok(tries < 300, 'Kate’s part never ended');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  } finally {
    globalThis.fetch = noNetwork;
  }
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
    ['PUT', '/api/accounts/1/key'],
    ['DELETE', '/api/users/2'],
    ['PATCH', '/api/me'],
  ] as const) {
    const res = await app.inject({ method, url, payload: {} });
    assert.equal(res.statusCode, 403, `${method} ${url}`);
  }
});

type App = ReturnType<typeof server>['app'];
const call = (
  app: App,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  cookie?: string,
  payload?: object,
) => app.inject({ method, url, headers: cookie ? { cookie } : {}, ...(payload ? { payload } : {}) });
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

test('the admin downloads a copy of the database with their password and a fresh code, and nobody else can', async () => {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  const secret = 'JBSWY3DPEHPK3PXP';
  claimAdmin(db, {
    name: 'admin',
    passwordHash: hashPassword('correct horse battery'),
    totpSecret: secret,
    totpStep: 0,
  });
  const friend = addUser(db, { name: 'Kate', passwordHash: 'h', totpSecret: 'S', totpStep: 0 });
  addWallet(db, friend.id, EVM);
  const ctx = createContext({ config: loadConfig('config.example.json'), db, env: { HOST: '0.0.0.0' } });
  const { app } = createApp(ctx);
  const step = Math.floor(Date.now() / 30_000);
  const backup = (cookie: string, password: string, code: string) =>
    call(app, 'POST', '/api/backup', cookie, { password, code });

  assert.equal(
    (await backup(sessionOf(db, friend.id), 'correct horse battery', totpCode(secret, step))).statusCode,
    403,
  );
  const wrong = await backup(sessionOf(db, ADMIN_ID), 'wrong horse battery', totpCode(secret, step));
  assert.deepEqual([wrong.statusCode, wrong.json()], [403, { error: 'Wrong password or code' }]);

  const res = await backup(sessionOf(db, ADMIN_ID), 'correct horse battery', totpCode(secret, step));
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'application/vnd.sqlite3');
  assert.match(String(res.headers['content-disposition']), /^attachment; filename="stashboard-\d{4}-\d{2}-\d{2}\.db"$/);
  const file = join(mkdtempSync(join(tmpdir(), 'stashboard-test-')), 'copy.db');
  writeFileSync(file, res.rawPayload);
  const copy = new DatabaseSync(file, { readOnly: true });
  assert.equal((copy.prepare('SELECT COUNT(*) AS n FROM accounts').get() as { n: number }).n, 1);
  copy.close();

  const again = await backup(sessionOf(db, ADMIN_ID), 'correct horse battery', totpCode(secret, step));
  assert.equal(again.statusCode, 403, 'a code works once');
});

test('on this machine alone, without sign-in, the backup needs no password', async () => {
  const { app } = server({ HOST: '127.0.0.1' });
  const res = await call(app, 'POST', '/api/backup', undefined, {});
  assert.equal(res.statusCode, 200);
  assert.equal(res.rawPayload.subarray(0, 15).toString(), 'SQLite format 3');
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

test('the board needs a session, and leaving it takes true or false', async () => {
  const { app, db } = server({}, true);
  assert.equal(await status(app, '/api/board'), '401');
  assert.equal(await status(app, '/board/AAAAAAAA'), '302 /login');
  assert.equal(await status(app, '/api/board/AAAAAAAA/portfolio'), '401');
  const admin = sessionOf(db, ADMIN_ID);
  const page = await call(app, 'GET', '/board/AAAAAAAA', admin);
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /<body data-viewing /);
  assert.equal((await call(app, 'GET', '/api/board/AAAAAAAA/portfolio', admin)).statusCode, 404);
  assert.equal((await call(app, 'GET', '/api/board/AAAAAAAA/history', admin)).statusCode, 404);
  assert.equal((await call(app, 'GET', '/api/board', admin)).json().onBoard, true);
  for (const payload of [{}, { onBoard: 'no' }, { hideAmounts: 1 }]) {
    assert.equal((await call(app, 'PUT', '/api/preferences', admin, payload)).statusCode, 400);
  }
  const left = await call(app, 'PUT', '/api/preferences', admin, { onBoard: false });
  assert.deepEqual(left.json(), { hideAmounts: false, onBoard: false });
  assert.equal((await call(app, 'GET', '/api/board', admin)).json().onBoard, false);
});

test('looking through someone else’s board changes nothing of theirs', async () => {
  const { app, db } = server({}, true);
  const friend = (name: string) => addUser(db, { name, passwordHash: 'x', totpSecret: 'x', totpStep: 0 }).id;
  const ids = [ADMIN_ID, friend('Kate'), friend('Bob')];
  const addresses = [EVM, '0x8617E340B3D01FA5F11F306F4090FD50E238070D', '0xde709f2102306220921060314715629080e2fb77'];
  const snapshot = startSnapshot(db);
  const wallets = ids.map((id, i) => {
    const wallet = addWallet(db, id, addresses[i]!, `Main ${i}`);
    saveOutcome(db, snapshot, wallet.id, {
      status: 'ok',
      holdings: [
        {
          chain: 'ethereum',
          protocol: null,
          symbol: 'ETH',
          quantity: 3 - i,
          price: 2000,
          value: (3 - i) * 2000,
          type: 'wallet',
        },
      ],
      warnings: [],
    });
    return wallet;
  });
  finishSnapshot(db, snapshot);
  const admin = sessionOf(db, ADMIN_ID);
  const kate = sessionOf(db, ids[1]!);

  const board = (await call(app, 'GET', '/api/board', kate)).json();
  const top = board.rows[0];
  assert.equal(top.you, false);
  const theirs = await call(app, 'GET', `/api/board/${top.key}/portfolio`, kate);
  assert.equal(theirs.statusCode, 200);
  const shown = theirs.json().sources[0];
  assert.equal(shown.label, 'EVM wallet');

  for (const id of [shown.id, wallets[0]!.id]) {
    assert.equal((await call(app, 'PATCH', `/api/accounts/${id}`, kate, { label: 'Mine now' })).statusCode, 404);
    assert.equal((await call(app, 'DELETE', `/api/accounts/${id}`, kate)).statusCode, 404);
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
    for (const url of [`/api/board/${top.key}`, `/api/board/${top.key}/portfolio`, `/board/${top.key}`]) {
      assert.equal((await call(app, method, url, kate, {})).statusCode, 404, `${method} ${url}`);
    }
  }
  assert.equal((await call(app, 'PUT', '/api/assets/ETH/category', kate, { category: 'Memes' })).statusCode, 200);
  assert.equal((await call(app, 'POST', '/api/heat/dismiss', kate, { assets: ['ETH'] })).statusCode, 200);
  assert.equal((await call(app, 'PUT', '/api/preferences', kate, { onBoard: false })).statusCode, 200);

  assert.deepEqual(
    listAccounts(db, ADMIN_ID).map((a) => a.label),
    ['Main 0'],
  );
  const own = (await call(app, 'GET', '/api/portfolio', admin)).json();
  assert.equal(own.assets[0].category, 'ETH', 'a category chosen by someone else stays theirs');
  assert.equal((await call(app, 'GET', '/api/board', admin)).json().onBoard, true);
  assert.equal(
    (await call(app, 'GET', `/api/board/${top.key}/portfolio`, kate)).statusCode,
    404,
    'having left, Kate no longer sees it',
  );
});
