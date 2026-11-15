import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDb } from '../../src/storage/index.ts';
import {
  createShare,
  deleteShare,
  getShare,
  listShares,
  parseSharePayload,
  shareHasLogo,
} from '../../src/services/shares.ts';

const row = (name: string, share: number, value = 100) => ({
  name,
  share,
  value,
  color: '#3987e5',
  logo: { kind: 'token', key: name },
});
const body = (extra: Record<string, unknown> = {}) => ({
  title: 'Allocation by asset',
  days: 7,
  rows: [row('ETH', 0.6), row('BTC', 0.4)],
  total: 1000,
  ...extra,
});

test('a share without amounts keeps shares and drops every value, whatever the page sent', () => {
  const parsed = parseSharePayload(body());
  assert.ok('payload' in parsed);
  assert.equal(parsed.payload.total, null);
  assert.deepEqual(
    parsed.payload.rows.map((r) => [r.name, r.share, r.value]),
    [
      ['ETH', 0.6, null],
      ['BTC', 0.4, null],
    ],
  );
});

test('a share with amounts keeps them', () => {
  const parsed = parseSharePayload(body({ showAmounts: true }));
  assert.ok('payload' in parsed);
  assert.equal(parsed.payload.total, 1000);
  assert.equal(parsed.payload.rows[0]?.value, 100);
});

test('malformed shares are refused', () => {
  assert.ok('error' in parseSharePayload(body({ days: 365 })));
  assert.ok('error' in parseSharePayload(body({ title: '' })));
  assert.ok('error' in parseSharePayload(body({ rows: [] })));
  assert.ok('error' in parseSharePayload(body({ rows: Array.from({ length: 13 }, (_, i) => row(`A${i}`, 0.01)) })));
  assert.ok('error' in parseSharePayload(body({ rows: [{ ...row('ETH', 0.5), color: 'red; background: url(x)' }] })));
  assert.ok('error' in parseSharePayload(body({ rows: [row('ETH', 1.5)] })));
  const odd = parseSharePayload(body({ rows: [{ ...row('ETH', 0.5), logo: { kind: 'file', key: '../db' } }] }));
  assert.ok('payload' in odd);
  assert.equal(odd.payload.rows[0]?.logo, null);
});

test('a link works until it expires or is turned off, and opens only its own logos', () => {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  const parsed = parseSharePayload(body());
  assert.ok('payload' in parsed);
  const now = Date.now();
  const share = createShare(db, parsed.payload, 1, now);
  assert.match(share.token, /^[A-Za-z0-9_-]{22}$/);

  assert.equal(getShare(db, share.token, now)?.payload.title, 'Allocation by asset');
  assert.ok(shareHasLogo(share, 'token', 'ETH'));
  assert.ok(!shareHasLogo(share, 'token', 'SOL'));
  assert.equal(getShare(db, 'not a token'), null);
  assert.equal(getShare(db, share.token, now + 2 * 24 * 60 * 60_000), null);

  const other = createShare(db, parsed.payload, 7, now);
  assert.deepEqual(
    listShares(db, now + 2 * 24 * 60 * 60_000).map((s) => s.token),
    [other.token],
  );
  assert.ok(deleteShare(db, other.token));
  assert.equal(getShare(db, other.token, now), null);
});
