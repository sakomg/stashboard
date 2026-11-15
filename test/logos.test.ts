import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createResolver, loadAssetRules } from '../src/assets.ts';
import { addWallet, finishSnapshot, openDb, saveOutcome, startSnapshot } from '../src/db.ts';
import { logoFile, logoIndex, noteLogos, sniffImage } from '../src/logos.ts';
import { wantedLogos } from '../src/view.ts';

const freshDb = () => openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));

test('an image is recognised by its bytes, not by what the host calls it', () => {
  assert.equal(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])), 'image/png');
  assert.equal(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(sniffImage(Buffer.from('GIF89a')), 'image/gif');
  assert.equal(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1')), 'image/webp');
  assert.equal(sniffImage(Buffer.from('  <svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'image/svg+xml');
  assert.equal(sniffImage(Buffer.from('<?xml version="1.0"?><svg></svg>')), 'image/svg+xml');
});

test('a page or an error message is not an image', () => {
  assert.equal(sniffImage(Buffer.from('<!doctype html><html><body>Not found</body></html>')), null);
  assert.equal(sniffImage(Buffer.from('{"error":"rate limited"}')), null);
  assert.equal(sniffImage(Buffer.alloc(0)), null);
});

test('logo hints are remembered, and only https sources are accepted', () => {
  const db = freshDb();
  noteLogos(db, [
    { kind: 'token', key: 'ARB', url: 'https://cdn.example/arb.png' },
    { kind: 'token', key: 'EVIL', url: 'http://cdn.example/evil.png' },
    { kind: 'token', key: 'LOCAL', url: 'file:///etc/passwd' },
    { kind: 'chain', key: 'arbitrum', url: 'https://cdn.example/arbitrum.png', name: 'Arbitrum One' },
  ]);
  const keys = (db.prepare('SELECT key FROM logos ORDER BY key').all() as { key: string }[]).map((r) => r.key);
  assert.deepEqual(keys, ['ARB', 'arbitrum']);
});

test('nothing is offered to the page until its file is stored', () => {
  const db = freshDb();
  noteLogos(db, [{ kind: 'chain', key: 'arbitrum', url: 'https://cdn.example/a.png', name: 'Arbitrum One' }]);
  assert.deepEqual(logoIndex(db), { available: {}, chains: { arbitrum: 'Arbitrum One' } });
  assert.equal(logoFile(db, 'chain', 'arbitrum'), null);

  db.prepare("UPDATE logos SET file = 'abc.png', media_type = 'image/png' WHERE key = 'arbitrum'").run();
  assert.deepEqual(Object.keys(logoIndex(db).available), ['chain/arbitrum']);
  assert.equal(logoFile(db, 'chain', 'arbitrum')?.type, 'image/png');
});

test('a new source address makes a failed logo worth trying again', () => {
  const db = freshDb();
  noteLogos(db, [{ kind: 'token', key: 'ARB', url: 'https://cdn.example/old.png' }]);
  db.prepare("UPDATE logos SET tried_at = '2026-01-01T00:00:00.000Z'").run();

  noteLogos(db, [{ kind: 'token', key: 'ARB', url: 'https://cdn.example/old.png' }]);
  assert.equal((db.prepare('SELECT tried_at FROM logos').get() as { tried_at: string | null }).tried_at !== null, true);

  db.prepare("UPDATE logos SET file = 'old.png', media_type = 'image/png'").run();
  noteLogos(db, [{ kind: 'token', key: 'ARB', url: 'https://cdn.example/old.png' }]);
  const before = logoIndex(db).available['token/ARB'];
  assert.ok(before);

  // A different address also drops the stored image, so a wrong logo gets replaced.
  noteLogos(db, [{ kind: 'token', key: 'ARB', url: 'https://cdn.example/new.png' }]);
  assert.deepEqual(logoIndex(db).available, {});

  // Once the new image is in, the page is told to ask for it under a new address.
  db.prepare("UPDATE logos SET file = 'new.png', media_type = 'image/png'").run();
  assert.notEqual(logoIndex(db).available['token/ARB'], before);
  assert.equal((db.prepare('SELECT tried_at FROM logos').get() as { tried_at: string | null }).tried_at, null);
});

test('the portfolio asks for its assets, chains and protocols, and always for the native coins', () => {
  const db = freshDb();
  const wallet = addWallet(db, '0x52908400098527886E0F7030069857D2E4169EE7');
  const snapshot = startSnapshot(db);
  saveOutcome(db, snapshot, wallet.id, {
    status: 'ok',
    holdings: [
      { chain: 'base', protocol: null, symbol: 'WETH', quantity: 1, price: 2000, value: 2000, type: 'wallet' },
      { chain: 'arbitrum', protocol: 'GMX V2', symbol: 'ARB', quantity: 10, price: 1, value: 10, type: 'staked' },
      { chain: 'solana', protocol: null, symbol: 'NVDAx', quantity: 1, price: 160, value: 160, type: 'wallet' },
    ],
    warnings: [],
  });
  finishSnapshot(db, snapshot);

  const wanted = wantedLogos(db, createResolver(loadAssetRules()));
  const of = (kind: string) => wanted.filter((w) => w.kind === kind);
  const token = (key: string) => wanted.find((w) => w.kind === 'token' && w.key === key);

  for (const native of ['BNB', 'ETH', 'SOL', 'TON']) assert.ok(token(native), native);
  assert.deepEqual(token('ETH')?.alternatives, ['WETH']);
  assert.deepEqual(token('NVDA')?.lookup, ['NVDAx', 'NVDA']);
  assert.deepEqual(token('ARB')?.lookup, ['ARB']);
  assert.deepEqual(
    of('chain')
      .map((w) => w.key)
      .sort(),
    ['arbitrum', 'base', 'solana'],
  );
  assert.deepEqual(
    of('protocol').map((w) => w.key),
    ['GMX V2'],
  );
});
