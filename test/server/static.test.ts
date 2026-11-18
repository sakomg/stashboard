import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../../src/lib/config.ts';
import { createApp } from '../../src/server/app.ts';
import { createContext } from '../../src/server/context.ts';
import { claimAdmin, openDb } from '../../src/storage/index.ts';

const pages = ['/', '/setup'];

async function page(url: string): Promise<string> {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  const ctx = createContext({ config: loadConfig('config.example.json'), db, env: { HOST: '127.0.0.1' } });
  const res = await createApp(ctx).app.inject({ method: 'GET', url });
  assert.equal(res.statusCode, 200, url);
  return res.body;
}

const symbols = (html: string): Set<string> => new Set([...html.matchAll(/<symbol id="([^"]+)"/g)].map((m) => m[1]!));

test('every page carries the icon sprite, so icons never wait for the network', async () => {
  for (const url of pages) {
    const html = await page(url);
    assert.match(html, /<body[^>]*><svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" hidden><symbol id=/, url);
    assert.ok(!html.includes('/icons.svg'), url);
  }
});

test('every icon the pages name is in the sprite, and no id is used twice', async () => {
  const html = await page('/');
  const sprite = symbols(html);
  const named = [...html.matchAll(/<use href="#([^"]+)"/g)].map((m) => m[1]!);
  const root = new URL('../../public/', import.meta.url);
  for (const name of readdirSync(root, { recursive: true }) as string[]) {
    if (!name.endsWith('.js')) continue;
    const text = readFileSync(new URL(name, root), 'utf8');
    named.push(...[...text.matchAll(/\bicon(?:Button)?\('([a-z0-9-]+)'/g)].map((m) => m[1]!));
  }
  assert.deepEqual(
    [...new Set(named)].filter((name) => !sprite.has(name)),
    [],
  );
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]!);
  assert.deepEqual(
    ids.filter((id, i) => ids.indexOf(id) !== i),
    [],
  );
});

test('the pages name a manifest and a home-screen icon, served before sign-in', async () => {
  const html = await page('/');
  assert.match(html, /<link rel="manifest" href="\/common\/manifest\.webmanifest" \/>/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/common\/icons\/apple-touch-icon\.png" \/>/);

  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  claimAdmin(db, { name: 'admin', passwordHash: 'x', totpSecret: 'JBSWY3DPEHPK3PXP', totpStep: 0 });
  const ctx = createContext({ config: loadConfig('config.example.json'), db, env: { HOST: '0.0.0.0' } });
  const { app } = createApp(ctx);
  const get = (url: string) => app.inject({ method: 'GET', url });
  const manifest = await get('/common/manifest.webmanifest');
  assert.equal(manifest.statusCode, 200);
  assert.equal(manifest.headers['content-type'], 'application/manifest+json');
  const { start_url, display, icons } = manifest.json() as {
    start_url: string;
    display: string;
    icons: { src: string; sizes: string }[];
  };
  assert.equal(start_url, '/');
  assert.equal(display, 'standalone');
  for (const src of [...icons.map((i) => i.src), '/common/icons/apple-touch-icon.png']) {
    const res = await get(src);
    assert.equal(res.statusCode, 200, src);
    assert.equal(res.headers['content-type'], 'image/png', src);
  }
});
