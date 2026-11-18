import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import type { Holding } from '../../src/domain/types.ts';
import { loadConfig } from '../../src/lib/config.ts';
import { runCollection } from '../../src/services/collector.ts';
import {
  ADMIN_ID,
  addUser,
  addWallet,
  createInvite,
  createReset,
  createSession,
  currentState,
  finishSnapshot,
  getUser,
  inviteValid,
  joinWithInvite,
  listAccounts,
  listInvites,
  migrate,
  openDb,
  removeAccount,
  removeUser,
  renameAccount,
  resetFor,
  resetWithLink,
  saveOutcome,
  sessionUser,
  startSnapshot,
} from '../../src/storage/index.ts';

const freshDb = () => openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
const key = randomBytes(32);
const EVM = '0x52908400098527886E0F7030069857D2E4169EE7';
const OTHER = '0x8617E340B3D01FA5F11F306F4090FD50E238070D';
const eth: Holding = {
  chain: 'ethereum',
  protocol: null,
  symbol: 'ETH',
  quantity: 1,
  price: 2000,
  value: 2000,
  type: 'wallet',
};
const friendOf = (db: DatabaseSync, name = 'Kate') =>
  addUser(db, { name, passwordHash: 'h', totpSecret: 'S', totpStep: 0 });
const count = (db: DatabaseSync, sql: string, ...args: (string | number)[]) =>
  (db.prepare(sql).get(...args) as { n: number }).n;

test('a database from before people keeps everything, all of it now the admin’s', () => {
  const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), 'stashboard-test-')), 'stashboard.db'));
  migrate(db, 10);
  db.exec(`
    INSERT INTO settings (key, value) VALUES
      ('owner', '{"passwordHash":"argon2id$s$h","totpSecret":"JBSWY3DPEHPK3PXP"}'),
      ('hide_amounts', '1'),
      ('zerion_chains_at', '123');
    INSERT INTO accounts (id, kind, label, address, address_key) VALUES
      (4, 'evm', 'Ledger', '0xabc', '0xabc'),
      (7, 'binance', 'Binance', '', 'print');
    INSERT INTO exchange_keys (account_id, key_hint, sealed) VALUES (7, '…wxyz', 'sealed');
    INSERT INTO snapshots (id, started_at, finished_at) VALUES (1, '2026-01-01', '2026-01-01');
    INSERT INTO snapshot_accounts (snapshot_id, account_id, status) VALUES (1, 4, 'ok'), (1, 7, 'ok');
    INSERT INTO holdings (snapshot_id, account_id, chain, symbol, type, quantity, value_usd)
      VALUES (1, 4, 'ethereum', 'ETH', 'wallet', 1, 2000), (1, 7, 'binance', 'BTC', 'wallet', 1, 60000);
    INSERT INTO sessions (token_hash, created_at, expires_at) VALUES ('hash', '2026-01-01', '2099-01-01');
    INSERT INTO shares (token, created_at, expires_at, payload) VALUES ('tok', '2026-01-01', '2099-01-01', '{}');
    INSERT INTO asset_categories (key, manual, auto) VALUES ('PONS', 'Memes', 'DeFi'), ('ARB', NULL, 'L2');
  `);

  migrate(db);

  const admin = db.prepare('SELECT * FROM users').all() as Record<string, unknown>[];
  assert.equal(admin.length, 1);
  assert.equal(admin[0]!.id, ADMIN_ID);
  assert.equal(admin[0]!.name, 'admin');
  assert.equal(admin[0]!.password_hash, 'argon2id$s$h');
  assert.equal(admin[0]!.totp_secret, 'JBSWY3DPEHPK3PXP');
  assert.equal(admin[0]!.admin, 1);
  assert.equal(admin[0]!.hide_amounts, 1);
  assert.deepEqual(
    (db.prepare('SELECT key FROM settings').all() as { key: string }[]).map((r) => r.key),
    ['zerion_chains_at'],
  );
  assert.deepEqual(
    db
      .prepare('SELECT id, user_id, label FROM accounts ORDER BY id')
      .all()
      .map((r) => ({ ...r })),
    [
      { id: 4, user_id: 1, label: 'Ledger' },
      { id: 7, user_id: 1, label: 'Binance' },
    ],
  );
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM holdings'), 2);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM exchange_keys'), 1);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM sessions WHERE user_id = 1'), 1);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM shares WHERE user_id = 1'), 1);
  assert.deepEqual(
    db
      .prepare('SELECT user_id, key, category FROM user_categories')
      .all()
      .map((r) => ({ ...r })),
    [{ user_id: 1, key: 'PONS', category: 'Memes' }],
  );
  assert.deepEqual(
    db
      .prepare('SELECT key, auto FROM asset_categories ORDER BY key')
      .all()
      .map((r) => ({ ...r })),
    [
      { key: 'ARB', auto: 'L2' },
      { key: 'PONS', auto: 'DeFi' },
    ],
  );

  assert.equal((db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys, 1);
  db.prepare('DELETE FROM accounts WHERE id = 7').run();
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM holdings'), 1, 'history still goes with its account');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM exchange_keys'), 0, 'and so does the key');
});

test('two people can hold the same wallet, and nobody renames or removes another’s', () => {
  const db = freshDb();
  const friend = friendOf(db);
  const mine = addWallet(db, ADMIN_ID, EVM, 'Main');
  const theirs = addWallet(db, friend.id, EVM.toLowerCase(), 'Kate main');
  assert.throws(() => addWallet(db, friend.id, EVM), /already added/);

  assert.deepEqual(
    listAccounts(db, ADMIN_ID).map((a) => a.id),
    [mine.id],
  );
  assert.deepEqual(
    listAccounts(db, friend.id).map((a) => a.id),
    [theirs.id],
  );
  assert.equal(listAccounts(db, 'all').length, 2);

  assert.equal(renameAccount(db, friend.id, mine.id, 'Mine now'), false);
  assert.equal(removeAccount(db, friend.id, mine.id), false);
  assert.equal(listAccounts(db, ADMIN_ID)[0]!.label, 'Main');
});

test('one collection run serves everyone, and each sees only their own accounts', () => {
  const db = freshDb();
  const friend = friendOf(db);
  const mine = addWallet(db, ADMIN_ID, EVM);
  const theirs = addWallet(db, friend.id, OTHER);
  const run = startSnapshot(db);
  saveOutcome(db, run, mine.id, { status: 'ok', holdings: [eth], warnings: [] });
  saveOutcome(db, run, theirs.id, { status: 'ok', holdings: [{ ...eth, quantity: 3, value: 6000 }], warnings: [] });
  finishSnapshot(db, run);

  assert.deepEqual(
    currentState(db, ADMIN_ID).map((s) => s.holdings[0]!.value),
    [2000],
  );
  assert.deepEqual(
    currentState(db, friend.id).map((s) => s.holdings[0]!.value),
    [6000],
  );
  assert.equal(currentState(db, 'all').length, 2);
});

test('an invite works once, until it expires, and the name must be free', () => {
  const db = freshDb();
  const now = Date.parse('2026-11-16T12:00:00Z');
  const invite = createInvite(db, ADMIN_ID, 60_000, key, now);
  assert.ok(inviteValid(db, invite.token, now));
  assert.ok(!inviteValid(db, invite.token, now + 60_000));
  assert.ok(!inviteValid(db, 'not a token', now));

  assert.throws(
    () => joinWithInvite(db, invite.token, { name: 'Admin', passwordHash: 'h', totpSecret: 'S', totpStep: 0 }, now),
    /taken/,
  );
  assert.ok(inviteValid(db, invite.token, now), 'a refused name does not use the invite up');

  const kate = joinWithInvite(db, invite.token, { name: 'Kate', passwordHash: 'h', totpSecret: 'S', totpStep: 0 }, now);
  assert.equal(getUser(db, kate.id)?.admin, false);
  assert.throws(
    () => joinWithInvite(db, invite.token, { name: 'Kate2', passwordHash: 'h', totpSecret: 'S', totpStep: 0 }, now),
    /expired or was already used/,
  );

  createInvite(db, ADMIN_ID, 60_000, key, now);
  assert.equal(listInvites(db, key, now).length, 1);
  assert.equal(listInvites(db, key, now + 60_000).length, 0, 'expired invites are cleared');
});

test('a pending invite link can be shown again, but only with the vault key, and never from the database alone', () => {
  const db = freshDb();
  const now = Date.parse('2026-11-17T09:00:00Z');
  const invite = createInvite(db, ADMIN_ID, 60_000, key, now);
  const stored = JSON.stringify(db.prepare('SELECT * FROM invites').all());
  assert.ok(!stored.includes(invite.token), 'the token is not stored in the clear');

  assert.deepEqual(listInvites(db, key, now), [
    { id: invite.id, createdAt: invite.createdAt, expiresAt: invite.expiresAt, token: invite.token, person: null },
  ]);
  assert.equal(listInvites(db, randomBytes(32), now)[0]?.token, null, 'another key opens nothing and breaks nothing');

  db.prepare('UPDATE invites SET sealed = NULL').run();
  assert.equal(listInvites(db, key, now)[0]?.token, null, 'an invite from before links were kept has none');
  assert.ok(inviteValid(db, invite.token, now), 'and still works');
});

test('a reset link gives one person a new sign-in once, ends their sessions and keeps everything else', () => {
  const db = freshDb();
  const now = Date.parse('2026-11-17T09:00:00Z');
  const friend = friendOf(db);
  const wallet = addWallet(db, friend.id, EVM);
  const session = createSession(db, friend.id, 60_000);
  const adminSession = createSession(db, ADMIN_ID, 60_000);

  assert.equal(createReset(db, ADMIN_ID, ADMIN_ID, 60_000, key, now), null, 'the admin resets through the console');
  assert.equal(createReset(db, ADMIN_ID, 99, 60_000, key, now), null);
  const first = createReset(db, ADMIN_ID, friend.id, 60_000, key, now)!;
  const reset = createReset(db, ADMIN_ID, friend.id, 60_000, key, now)!;
  assert.equal(first.person, 'Kate');
  assert.equal(resetFor(db, first.token, now), null, 'a new reset link replaces the one before');
  assert.deepEqual(
    listInvites(db, key, now).map((i) => [i.token, i.person]),
    [[reset.token, 'Kate']],
  );

  assert.equal(resetFor(db, reset.token, now)?.id, friend.id);
  assert.equal(resetFor(db, reset.token, now + 60_000), null);
  assert.ok(!inviteValid(db, reset.token, now), 'a reset link does not let a new person join');
  assert.throws(
    () => joinWithInvite(db, reset.token, { name: 'Bob', passwordHash: 'h', totpSecret: 'S', totpStep: 0 }, now),
    /expired or was already used/,
  );
  const invite = createInvite(db, ADMIN_ID, 60_000, key, now);
  assert.throws(
    () => resetWithLink(db, invite.token, { passwordHash: 'h2', totpSecret: 'S2', totpStep: 7 }, now),
    /expired or was already used/,
    'an invite link resets nobody',
  );

  assert.equal(
    resetWithLink(db, reset.token, { passwordHash: 'h2', totpSecret: 'S2', totpStep: 7 }, now).id,
    friend.id,
  );
  const row = db.prepare('SELECT name, password_hash, totp_secret, totp_step FROM users WHERE id = ?').get(friend.id);
  assert.deepEqual({ ...row }, { name: 'Kate', password_hash: 'h2', totp_secret: 'S2', totp_step: 7 });
  assert.equal(sessionUser(db, session), null);
  assert.equal(sessionUser(db, adminSession), ADMIN_ID);
  assert.deepEqual(
    listAccounts(db, friend.id).map((a) => a.id),
    [wallet.id],
  );
  assert.throws(
    () => resetWithLink(db, reset.token, { passwordHash: 'h3', totpSecret: 'S3', totpStep: 8 }, now),
    /expired or was already used/,
  );
  assert.ok(inviteValid(db, invite.token, now));

  createReset(db, ADMIN_ID, friend.id, 60_000, key, now);
  removeUser(db, friend.id);
  assert.deepEqual(
    listInvites(db, key, now).map((i) => i.id),
    [invite.id],
    'removing a person turns off their reset link',
  );
});

test('removing a person removes everything they had and nothing else, and the admin stays', () => {
  const db = freshDb();
  const friend = friendOf(db);
  const mine = addWallet(db, ADMIN_ID, EVM);
  const theirs = addWallet(db, friend.id, EVM);
  const run = startSnapshot(db);
  saveOutcome(db, run, mine.id, { status: 'ok', holdings: [eth], warnings: [] });
  saveOutcome(db, run, theirs.id, { status: 'ok', holdings: [eth], warnings: [] });
  finishSnapshot(db, run);
  const session = createSession(db, friend.id, 60_000);
  createInvite(db, friend.id, 60_000, key);

  assert.equal(removeUser(db, friend.id), true);
  assert.equal(sessionUser(db, session), null);
  assert.equal(listAccounts(db, 'all').length, 1);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM holdings'), 1);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM invites'), 0);
  assert.equal(removeUser(db, ADMIN_ID), false);
});

test('an account removed while a run reads it is left out, and the run still saves the others', async () => {
  const db = freshDb();
  const friend = friendOf(db);
  const ton = (byte: string) => `0:${byte.repeat(64)}`;
  const mine = addWallet(db, ADMIN_ID, ton('a'));
  const theirs = addWallet(db, friend.id, ton('b'));
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    removeUser(db, friend.id);
    throw new Error('offline');
  }) as typeof fetch;
  try {
    const run = await runCollection(db, loadConfig('config.example.json'));
    assert.equal(run.length, 1, 'the removed person gets no snapshot');
    assert.deepEqual(
      db
        .prepare('SELECT account_id, status FROM snapshot_accounts WHERE snapshot_id = ?')
        .all(run[0]!)
        .map((r) => ({ ...r })),
      [{ account_id: mine.id, status: 'error' }],
    );
    assert.equal(
      listAccounts(db, 'all').some((a) => a.id === theirs.id),
      false,
    );
  } finally {
    globalThis.fetch = realFetch;
  }
});
