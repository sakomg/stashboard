import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { createResolver, loadAssetRules } from '../../src/domain/assets.ts';
import type { Zone } from '../../src/domain/heat.ts';
import type { Holding } from '../../src/domain/types.ts';
import { notifyPeople, vapidKeys, welcome, type NotifyOptions } from '../../src/services/notify.ts';
import {
  ADMIN_ID,
  addWallet,
  finishSnapshot,
  markHeatSeen,
  openDb,
  saveOutcome,
  saveSignals,
  setSetting,
  startSnapshot,
  subscriptionsOf,
} from '../../src/storage/index.ts';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'stashboard-test-'));
const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

const resolve = createResolver(loadAssetRules());
const target = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/device-1',
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
};
const holding = (symbol: string, quantity: number, price: number): Holding => ({
  chain: 'ethereum',
  protocol: null,
  symbol,
  quantity,
  price,
  value: quantity * price,
  type: 'wallet',
});

function setup() {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  const wallet = addWallet(db, ADMIN_ID, '0x52908400098527886E0F7030069857D2E4169EE7');
  const snapshot = startSnapshot(db);
  saveOutcome(db, snapshot, wallet.id, {
    status: 'ok',
    holdings: [holding('ETH', 1, 2000), holding('BONK', 1_000_000, 0.00002)],
    warnings: [],
  });
  finishSnapshot(db, snapshot);
  const heat = (asset: string, hour: number, zone: Zone, score: number) =>
    saveSignals(db, [
      {
        asset,
        time: `2026-11-18T${String(hour).padStart(2, '0')}:00:00.000Z`,
        pair: `${asset}USDT`,
        score,
        zone,
        components: [],
      },
    ]);
  const pushes: number[] = [];
  let status = 201;
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    pushes.push((init.body as Uint8Array).length);
    return new Response('', { status });
  }) as typeof fetch;
  const options: NotifyOptions = {
    resolveFor: () => resolve,
    subject: 'https://stash.example',
    staleAfterMs: 2 * 60 * 60_000,
    now: new Date('2026-11-18T23:30:00.000Z'),
  };
  const run = () => notifyPeople(db, options, (err) => assert.fail(String(err)));
  return { db, wallet, heat, pushes, options, run, gone: () => (status = 410) };
}

test('turning notifications on sends a welcome and leaves out what the page already shows', async () => {
  const { db, heat, pushes, options, run } = setup();
  heat('ETH', 1, 'overheated', 85);
  await welcome(db, ADMIN_ID, target, options);
  assert.equal(pushes.length, 1);
  assert.equal(await run(), 0, 'ETH was already overheated when notifications were turned on');
});

test('an asset that turns overheated is pushed once per episode, and not once dismissed', async () => {
  const { db, heat, pushes, options, run } = setup();
  await welcome(db, ADMIN_ID, target, options);
  pushes.length = 0;

  heat('ETH', 2, 'overheated', 85);
  assert.equal(await run(), 1);
  heat('ETH', 3, 'warm', 75);
  heat('ETH', 4, 'overheated', 86);
  assert.equal(await run(), 0, 'a dip into warm is the same episode');

  heat('ETH', 5, 'neutral', 50);
  heat('ETH', 6, 'overheated', 88);
  heat('BONK', 6, 'overheated', 90);
  assert.equal(await run(), 1, 'a new episode, with BONK in the same message');

  heat('ETH', 7, 'cold', 20);
  markHeatSeen(db, ADMIN_ID, ['ETH']);
  heat('ETH', 8, 'neutral', 50);
  heat('ETH', 9, 'cold', 20);
  markHeatSeen(db, ADMIN_ID, ['ETH']);
  assert.equal(await run(), 0, 'dismissed on the page before it was pushed');
  assert.equal(pushes.length, 2);
});

test('an account that stays out of date is pushed once, and again after it recovers and fails', async () => {
  const { db, wallet, pushes, options, run } = setup();
  await welcome(db, ADMIN_ID, target, options);
  pushes.length = 0;
  const failAt = (time: string) => {
    const snapshot = startSnapshot(db);
    saveOutcome(db, snapshot, wallet.id, { status: 'error', error: 'Zerion refused the key' });
    finishSnapshot(db, snapshot);
    db.prepare('UPDATE snapshots SET started_at = ? WHERE id = ?').run(time, snapshot);
  };
  db.prepare('UPDATE snapshots SET started_at = ? WHERE id = 1').run('2026-11-18T22:00:00.000Z');
  failAt('2026-11-18T23:00:00.000Z');
  assert.equal(await run(), 0, 'one failed update is not news yet');

  db.prepare('UPDATE snapshots SET started_at = ? WHERE id = 1').run('2026-11-18T20:00:00.000Z');
  assert.equal(await run(), 1);
  assert.equal(await run(), 0);
});

test('a subscription the push service no longer knows is dropped', async () => {
  const { db, heat, options, run, gone } = setup();
  await welcome(db, ADMIN_ID, target, options);
  gone();
  heat('ETH', 2, 'overheated', 85);
  assert.equal(await run(), 0);
  assert.deepEqual(subscriptionsOf(db, ADMIN_ID), []);
});

test('the VAPID key is kept sealed, and a key that cannot be unsealed starts over without old subscriptions', async () => {
  const { db, options } = setup();
  await welcome(db, ADMIN_ID, target, options);
  const first = vapidKeys(db);
  assert.deepEqual(vapidKeys(db), first);
  setSetting(db, 'vapid_keys', 'damaged.value.here');
  assert.notEqual(vapidKeys(db).publicKey, first.publicKey);
  assert.deepEqual(subscriptionsOf(db, ADMIN_ID), []);
});
