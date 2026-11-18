import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickName } from '../../src/domain/board.ts';

test('a name on the board is a Grand Theft Auto character that nobody has yet', () => {
  assert.equal(
    pickName(new Set(), () => 0),
    'Tommy Vercetti',
  );
  assert.equal(
    pickName(new Set(['Tommy Vercetti']), () => 0),
    'Lance Vance',
  );
  assert.equal(
    pickName(new Set(), () => 0.9999),
    'Huang Lee',
  );
});

test('with every character taken, a name gets a number', () => {
  const taken = new Set<string>();
  let name = pickName(taken, () => 0);
  while (!/ \d+$/.test(name)) {
    taken.add(name);
    name = pickName(taken, () => 0);
  }
  assert.equal(name, 'Tommy Vercetti 2');
  assert.equal(taken.size, 57);
  assert.equal(
    pickName(new Set([...taken, 'Tommy Vercetti 2']), () => 0),
    'Tommy Vercetti 3',
  );
});
