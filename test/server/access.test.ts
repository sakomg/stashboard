import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../../src/lib/config.ts';
import { createApp } from '../../src/server/app.ts';
import { createContext } from '../../src/server/context.ts';
import { createSession, openDb, saveOwner } from '../../src/storage/index.ts';

function server(env: NodeJS.ProcessEnv = {}, withOwner = false) {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  if (withOwner) saveOwner(db, { passwordHash: 'x', totpSecret: 'JBSWY3DPEHPK3PXP' });
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

  const cookie = `stashboard_session=${createSession(db, 60_000)}`;
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

test('the demo refuses to change accounts or collect', async () => {
  const { app } = server({ DEMO: '1', HOST: '127.0.0.1' });
  for (const [method, url] of [
    ['POST', '/api/wallets'],
    ['POST', '/api/exchanges'],
    ['POST', '/api/collect'],
    ['POST', '/api/history/reset'],
    ['DELETE', '/api/accounts/1'],
  ] as const) {
    const res = await app.inject({ method, url, payload: {} });
    assert.equal(res.statusCode, 403, `${method} ${url}`);
  }
});
