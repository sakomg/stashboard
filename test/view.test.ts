import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createResolver, loadAssetRules } from '../src/assets.ts';
import { addWallet, finishSnapshot, openDb, saveOutcome, startSnapshot } from '../src/db.ts';
import type { Holding } from '../src/types.ts';
import { historyView, portfolioView } from '../src/view.ts';

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
  const a = addWallet(db, '0x52908400098527886E0F7030069857D2E4169EE7');
  const b = addWallet(db, '0x8617E340B3D01FA5F11F306F4090FD50E238070D');

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
  const points = historyView(seeded(), resolve, null);
  assert.deepEqual(
    points.map((p) => [p.total, p.categories]),
    [
      [2500, { ETH: 2000, Stablecoins: 500 }],
      [2700, { ETH: 2200, Stablecoins: 500 }],
    ],
  );
});

test('portfolio view merges accounts, flags the stale one and hides full addresses', () => {
  const view = portfolioView(seeded(), resolve);
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
