import assert from 'node:assert/strict';
import { test } from 'node:test';
import { partDone, progressFor } from '../../src/server/collection.ts';

type State = 'waiting' | 'reading' | 'done' | 'failed';
const START = Date.parse('2026-11-18T10:00:00Z');
const run = (states: [number, State][], phase: 'accounts' | 'signals' = 'accounts', saved: number[] = []) => ({
  phase,
  startedAt: START,
  byPerson: true,
  accounts: states.map(([id, state]) => ({ id, state, note: null, saved: saved.includes(id) })),
});

test('each person sees only their own accounts, and when they start while someone else is ahead', () => {
  const mine = new Set([5, 6]);
  assert.equal(progressFor(null, mine), null);

  const fresh = progressFor(
    run([
      [1, 'reading'],
      [2, 'waiting'],
      [5, 'waiting'],
      [6, 'waiting'],
    ]),
    mine,
    START + 1000,
  )!;
  assert.deepEqual(
    fresh.accounts.map((a) => a.id),
    [5, 6],
  );
  assert.equal(fresh.startsIn, 6000, 'two accounts ahead at a guessed 3 s each');

  const going = run([
    [1, 'done'],
    [2, 'failed'],
    [3, 'done'],
    [4, 'reading'],
    [5, 'waiting'],
    [6, 'waiting'],
    [7, 'waiting'],
  ]);
  assert.equal(progressFor(going, mine, START + 30_000)!.startsIn, 10_000, 'one ahead at the 10 s this run takes');
});

test('there is no estimate once their own accounts have started, before anyone else, or for signals', () => {
  const mine = new Set([5, 6]);
  const at = START + 10_000;
  assert.equal(
    progressFor(
      run([
        [1, 'done'],
        [5, 'reading'],
        [6, 'waiting'],
      ]),
      mine,
      at,
    )!.startsIn,
    null,
  );
  assert.equal(
    progressFor(
      run([
        [5, 'done'],
        [6, 'done'],
        [7, 'reading'],
      ]),
      mine,
      at,
    )!.startsIn,
    null,
  );
  assert.equal(
    progressFor(
      run([
        [5, 'waiting'],
        [6, 'waiting'],
      ]),
      mine,
      at,
    )!.startsIn,
    0,
  );
  assert.equal(progressFor(run([[1, 'reading']]), mine, at)!.startsIn, null, 'no accounts of theirs');
  assert.equal(progressFor(run([[5, 'done']], 'signals'), mine, at)!.startsIn, null);
});

test('a person is done once their own accounts are saved, unless one of theirs is still waiting to be read', () => {
  const going = run(
    [
      [1, 'done'],
      [2, 'done'],
      [5, 'reading'],
    ],
    'accounts',
    [1, 2],
  );
  assert.equal(partDone(going, new Set([1, 2]), new Set()), true);
  assert.equal(partDone(going, new Set([5]), new Set()), false);
  assert.equal(partDone(going, new Set([9]), new Set()), true, 'not part of this update');
  assert.equal(partDone(going, new Set([1, 2, 3]), new Set([3])), false, 'an account they just added is queued');
  assert.equal(partDone({ ...going, byPerson: false }, new Set([1, 2]), new Set()), false);
  assert.equal(partDone(null, new Set([1]), new Set()), false);
});
