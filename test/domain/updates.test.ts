import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAY_SHARE, DEFI_SHARE, planUpdates } from '../../src/domain/updates.ts';

const DAY = 24 * 60;

function spent(dayLimit: number, evm: number, solana: number) {
  const plan = planUpdates(dayLimit, evm, solana);
  const defi = (evm * DAY) / plan.defiEveryMinutes;
  const balances = (evm + solana) * (DAY / plan.gapMinutes);
  return { plan, defi, total: defi + balances };
}

test("updates are spaced so a whole day of them fits in Zerion's allowance, DeFi reads in their quarter", () => {
  for (const [limit, evm, solana] of [
    [300, 6, 2],
    [500, 6, 2],
    [2000, 6, 2],
    [2000, 20, 5],
    [300, 40, 10],
  ] as const) {
    const { plan, defi, total } = spent(limit, evm, solana);
    assert.ok(total <= limit * DAY_SHARE, `${limit}/${evm}/${solana}: ${total} requests a day`);
    assert.ok(defi <= limit * DAY_SHARE * DEFI_SHARE, `${limit}/${evm}/${solana}: ${defi} DeFi reads a day`);
    assert.equal(plan.gapMinutes % 5, 0);
  }
});

test('a small key spaces updates out, a large one is held to the floor of ten minutes', () => {
  assert.deepEqual(planUpdates(300, 6, 2), {
    dayLimit: 300,
    assumed: false,
    gapMinutes: 60,
    defiEveryMinutes: 130,
    runsPerDay: 24,
  });
  assert.equal(planUpdates(2000, 6, 2).gapMinutes, 10);
  assert.equal(planUpdates(2000, 6, 2).defiEveryMinutes, 55);
});

test('without wallets read by Zerion only the one-minute pause remains, and an unknown key is assumed small', () => {
  assert.equal(planUpdates(2000, 0, 0).gapMinutes, 1);
  assert.equal(planUpdates(2000, 0, 0).runsPerDay, null);
  const unknown = planUpdates(null, 6, 2);
  assert.equal(unknown.assumed, true);
  assert.equal(unknown.dayLimit, 500);
});

test('even far too many wallets for the key get one update a day', () => {
  assert.equal(planUpdates(100, 200, 0).gapMinutes, DAY);
});
