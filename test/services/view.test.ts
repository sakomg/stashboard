import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createResolver, loadAssetRules } from '../../src/domain/assets.ts';
import {
  ADMIN_ID,
  addWallet,
  finishSnapshot,
  openDb,
  saveOutcome,
  savePriceChanges,
  startSnapshot,
} from '../../src/storage/index.ts';
import type { Holding } from '../../src/domain/types.ts';
import { historyView, portfolioView } from '../../src/services/view.ts';

const resolve = createResolver(loadAssetRules());
const holding = (symbol: string, quantity: number, price: number): Holding => ({
  chain: 'ethereum',
  protocol: null,
  symbol,
  quantity,
  price,
  value: quantity * price,
  type: 'wallet',
});

function seeded() {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  const a = addWallet(db, ADMIN_ID, '0x52908400098527886E0F7030069857D2E4169EE7');
  const b = addWallet(db, ADMIN_ID, '0x8617E340B3D01FA5F11F306F4090FD50E238070D');

  const first = startSnapshot(db);
  saveOutcome(db, first, a.id, { status: 'ok', holdings: [holding('ETH', 1, 2000)], warnings: [] });
  saveOutcome(db, first, b.id, { status: 'ok', holdings: [holding('USDC', 500, 1)], warnings: [] });
  finishSnapshot(db, first);

  const second = startSnapshot(db);
  saveOutcome(db, second, a.id, { status: 'ok', holdings: [holding('WETH', 1, 2200)], warnings: [] });
  saveOutcome(db, second, b.id, { status: 'error', error: 'down' });
  finishSnapshot(db, second);
  return db;
}

test('history carries a failed account forward instead of dropping it', () => {
  const points = historyView(seeded(), ADMIN_ID, resolve, null);
  assert.deepEqual(
    points.map((p) => [p.total, p.categories]),
    [
      [2500, { ETH: 2000, Stablecoins: 500 }],
      [2700, { ETH: 2200, Stablecoins: 500 }],
    ],
  );
});

test('accounts come largest first, whatever order they were added in', () => {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  const small = addWallet(db, ADMIN_ID, '0x52908400098527886E0F7030069857D2E4169EE7');
  const large = addWallet(db, ADMIN_ID, '0x8617E340B3D01FA5F11F306F4090FD50E238070D');
  const unread = addWallet(db, ADMIN_ID, '0x2F62F2B4c5fcd7570a709DeC05D68EA19c82A9ec');
  const snapshot = startSnapshot(db);
  saveOutcome(db, snapshot, small.id, { status: 'ok', holdings: [holding('USDC', 50, 1)], warnings: [] });
  saveOutcome(db, snapshot, large.id, { status: 'ok', holdings: [holding('ETH', 1, 2000)], warnings: [] });
  finishSnapshot(db, snapshot);
  assert.deepEqual(
    portfolioView(db, ADMIN_ID, resolve).sources.map((s) => [s.id, s.value]),
    [
      [large.id, 2000],
      [small.id, 50],
      [unread.id, 0],
    ],
  );
});

test('portfolio view merges accounts, flags the stale one and hides full addresses', () => {
  const view = portfolioView(seeded(), ADMIN_ID, resolve);
  assert.equal(view.netWorth, 2700);
  assert.deepEqual(
    view.sources.map((s) => [s.stale, s.value]),
    [
      [false, 2200],
      [true, 500],
    ],
  );
  assert.equal(view.sources[0]!.address, '0x5290…9EE7');
  assert.equal(view.assets[0]!.key, 'ETH');
  assert.deepEqual(view.changes, { d1: null, d7: null, d30: null });
});

test('7 and 30 days are estimated from prices only until history reaches that far', () => {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  const wallet = addWallet(db, ADMIN_ID, '0x52908400098527886E0F7030069857D2E4169EE7');
  const snapshot = startSnapshot(db);
  saveOutcome(db, snapshot, wallet.id, {
    status: 'ok',
    holdings: [holding('ETH', 1, 1100), holding('USDC', 900, 1)],
    warnings: [],
  });
  finishSnapshot(db, snapshot);
  const now = new Date();
  savePriceChanges(db, [{ asset: 'ETH', time: now.toISOString(), d7: 0.1, d30: null }]);

  const view = portfolioView(db, ADMIN_ID, resolve, now);
  assert.equal(view.changes.d7, null);
  assert.ok(view.estimates.d7);
  assert.ok(Math.abs(view.estimates.d7.change - (2000 / 1900 - 1)) < 1e-12);
  assert.equal(view.estimates.d30, null);

  const later = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
  assert.equal(portfolioView(db, ADMIN_ID, resolve, later).estimates.d7, null);
});
