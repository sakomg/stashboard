import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  AttemptLimiter,
  base32Decode,
  base32Encode,
  hashPassword,
  matchTotp,
  totpCode,
  verifyPassword,
} from '../../src/auth/index.ts';
import { backupDaily, createSession, deleteSession, openDb, sessionValid } from '../../src/storage/index.ts';

const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('TOTP matches the RFC 6238 test vectors', () => {
  assert.equal(base32Decode(SECRET).toString(), '12345678901234567890');
  assert.equal(base32Encode(Buffer.from('12345678901234567890')), SECRET);
  assert.equal(totpCode(SECRET, Math.floor(59 / 30)), '287082');
  assert.equal(totpCode(SECRET, Math.floor(1111111109 / 30)), '081804');
  assert.equal(totpCode(SECRET, Math.floor(20000000000 / 30)), '353130');
});

test('a code is accepted one step either side of now and nowhere else', () => {
  const now = 1111111109 * 1000;
  const step = Math.floor(now / 30000);
  assert.equal(matchTotp(SECRET, '081804', now), step);
  assert.equal(matchTotp(SECRET, '081 804', now), step);
  assert.equal(matchTotp(SECRET, totpCode(SECRET, step - 1), now), step - 1);
  assert.equal(matchTotp(SECRET, totpCode(SECRET, step + 1), now), step + 1);
  assert.equal(matchTotp(SECRET, totpCode(SECRET, step - 2), now), null);
  assert.equal(matchTotp(SECRET, '', now), null);
  assert.equal(matchTotp(SECRET, '0818041', now), step);
});

test('password hashes verify and differ per hash', () => {
  const hash = hashPassword('correct horse battery');
  assert.match(hash, /^argon2id\$/);
  assert.notEqual(hash, hashPassword('correct horse battery'));
  assert.equal(verifyPassword('correct horse battery', hash), true);
  assert.equal(verifyPassword('correct horse batterz', hash), false);
  assert.equal(verifyPassword('anything', 'not-a-hash'), false);
});

test('five failures lock an address out until the window passes', () => {
  const limiter = new AttemptLimiter(5, 15 * 60_000);
  const start = 1_000_000;
  for (let i = 0; i < 4; i++) limiter.fail('1.2.3.4', start + i);
  assert.equal(limiter.retryAfter('1.2.3.4', start + 10), 0);
  limiter.fail('1.2.3.4', start + 4);
  assert.equal(limiter.retryAfter('1.2.3.4', start + 5), 900);
  assert.equal(limiter.retryAfter('5.6.7.8', start + 5), 0);
  assert.equal(limiter.retryAfter('1.2.3.4', start + 15 * 60_000 + 1), 0);
  limiter.clear('1.2.3.4');
  assert.equal(limiter.retryAfter('1.2.3.4', start + 5), 0);
});

test('sessions expire and can be ended', () => {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  const token = createSession(db, 1000, 0);
  assert.equal(sessionValid(db, token, 500), true);
  assert.equal(sessionValid(db, token, 1500), false);
  assert.equal(sessionValid(db, 'made-up', 500), false);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(token) as { n: number }).n,
    0,
  );
  deleteSession(db, token);
  assert.equal(sessionValid(db, token, 500), false);
});

test('one backup a day, and old ones are pruned', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stashboard-test-'));
  const db = openDb(dir);
  const day = (n: number) => new Date(Date.UTC(2026, 0, n));
  const first = backupDaily(db, dir, 3, day(1));
  assert.ok(first && existsSync(first));
  assert.equal(backupDaily(db, dir, 3, day(1)), null);
  for (const n of [2, 3, 4]) backupDaily(db, dir, 3, day(n));
  assert.deepEqual(readdirSync(join(dir, 'backups')), [
    'stashboard-2026-01-02.db',
    'stashboard-2026-01-03.db',
    'stashboard-2026-01-04.db',
  ]);
});

test('the account is stored in the database and removing it ends every session', async () => {
  const { deleteOwner, getOwner, saveOwner } = await import('../../src/storage/index.ts');
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  assert.equal(getOwner(db), null);
  saveOwner(db, { passwordHash: 'h', totpSecret: SECRET });
  assert.deepEqual(getOwner(db), { passwordHash: 'h', totpSecret: SECRET });
  const token = createSession(db, 60_000);
  assert.equal(deleteOwner(db), true);
  assert.equal(getOwner(db), null);
  assert.equal(sessionValid(db, token), false);
  assert.equal(deleteOwner(db), false);
});

test('the QR code is a self-contained SVG', async () => {
  const { qrSvg } = await import('../../src/auth/qr.ts');
  const svg = qrSvg('otpauth://totp/Stashboard:dashboard?secret=GEZDGNBVGY3TQOJQ&issuer=Stashboard');
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 (\d+) \1"/);
  assert.ok(!svg.includes('<script') && !svg.includes('href'));
});
