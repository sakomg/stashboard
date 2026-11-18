import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createResolver, loadAssetRules } from '../../src/domain/assets.ts';
import type { Holding } from '../../src/domain/types.ts';
import { BOARD_MINIMUM, boardHistory, boardPortfolio, boardView } from '../../src/services/board.ts';
import {
  ADMIN_ID,
  addUser,
  addWallet,
  finishSnapshot,
  openDb,
  saveOutcome,
  setOnBoard,
  startSnapshot,
} from '../../src/storage/index.ts';

const resolve = createResolver(loadAssetRules());
const resolveFor = () => resolve;
const holding = (symbol: string, quantity: number, price: number): Holding => ({
  chain: 'ethereum',
  protocol: null,
  symbol,
  quantity,
  price,
  value: quantity * price,
  type: 'wallet',
});
const ADDRESSES = [
  '0x52908400098527886E0F7030069857D2E4169EE7',
  '0x8617E340B3D01FA5F11F306F4090FD50E238070D',
  '0xde709f2102306220921060314715629080e2fb77',
  '0x27b1fdb04752bbc536007a920d24acb045561c26',
];

function seeded(people: number) {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  const friend = (i: number) =>
    addUser(db, { name: `Friend ${i}`, passwordHash: 'x', totpSecret: 'x', totpStep: 0 }).id;
  const ids = [ADMIN_ID, ...Array.from({ length: people - 1 }, (_, i) => friend(i))];
  const snapshot = startSnapshot(db);
  ids.forEach((id, i) => {
    const wallet = addWallet(db, id, ADDRESSES[i]!, `Wallet of ${id}`);
    saveOutcome(db, snapshot, wallet.id, {
      status: 'ok',
      holdings: [holding('ETH', i + 1, 2000), holding('USDC', 100, 1), holding('PEPE', 1, 0.5)],
      warnings: [],
    });
  });
  finishSnapshot(db, snapshot);
  return { db, ids };
}

test('the board ranks everyone by net worth, and each row is a key, not a person', () => {
  const { db, ids } = seeded(4);
  const board = boardView(db, ids[1]!, resolveFor);
  assert.equal(board.open, true);
  assert.equal(board.others, 3);
  assert.deepEqual(
    board.rows.map((r) => [r.netWorth, r.you, r.wallets, r.exchanges]),
    [
      [8100.5, false, 1, 0],
      [6100.5, false, 1, 0],
      [4100.5, true, 1, 0],
      [2100.5, false, 1, 0],
    ],
  );
  const keys = board.rows.map((r) => r.key);
  assert.equal(new Set(keys).size, 4);
  for (const key of keys) assert.match(key, /^[A-Za-z0-9_-]{8}$/);
  for (const row of board.rows) assert.deepEqual(row.holdings, ['ETH', 'USDC', 'PEPE']);
  const names = board.rows.map((r) => r.name);
  assert.equal(new Set(names).size, 4);
  for (const name of names) assert.match(name, /^\S(.*\S)?$/);
  assert.deepEqual(
    boardView(db, ids[2]!, resolveFor).rows.map((r) => [r.key, r.name]),
    board.rows.map((r) => [r.key, r.name]),
    'a key and a name stay the same',
  );
  assert.deepEqual(
    boardView(db, ADMIN_ID, resolveFor).rows.map((r) => [r.key, r.name]),
    board.rows.map((r, i) => [r.key, ['Friend 2', 'Friend 1', 'Friend 0', 'admin'][i]]),
    'the admin sees who is who',
  );
  const text = JSON.stringify(board);
  for (const secret of ['Wallet of', 'Friend', '0x', '"id"', 'admin']) assert.ok(!text.includes(secret), secret);
});

test('a portfolio on the board opens as the dashboard, without account names or addresses', () => {
  const { db, ids } = seeded(4);
  const top = boardView(db, ids[1]!, resolveFor).rows[0]!;
  const view = boardPortfolio(db, ids[1]!, top.key, resolveFor)!;
  assert.deepEqual(view.board, { name: top.name, rank: 1, portfolios: 4, you: false });
  assert.equal(view.netWorth, 8100.5);
  assert.deepEqual(
    view.sources.map((s) => [s.id, s.label, s.address, s.error, s.warnings]),
    [[-1, 'EVM wallet', '', null, []]],
  );
  assert.deepEqual([...new Set(view.holdings.map((h) => [h.accountId, h.account].join()))], ['-1,EVM wallet']);
  assert.deepEqual(
    view.assets.map((a) => a.key),
    ['ETH', 'USDC', 'PEPE'],
  );
  const text = JSON.stringify(view);
  for (const secret of ['Wallet of', 'Friend', ...ADDRESSES.map((a) => a.slice(0, 6))]) {
    assert.ok(!text.includes(secret), secret);
  }
  assert.equal(boardHistory(db, ids[1]!, top.key, resolveFor, null)?.at(-1)?.total, 8100.5);
  assert.equal(boardPortfolio(db, ids[1]!, 'nonsense', resolveFor), null);
});

test('a row lists the five largest holdings, without loans, and the board brings their logos', () => {
  const { db, ids } = seeded(BOARD_MINIMUM);
  const snapshot = startSnapshot(db);
  const more = addWallet(db, ids[0]!, ADDRESSES[3]!, 'More');
  saveOutcome(db, snapshot, more.id, {
    status: 'ok',
    holdings: [holding('BTC', 1, 90000), holding('SOL', 10, 150), holding('LINK', 10, 15), holding('UNI', 10, 8)],
    warnings: [],
  });
  const loan = addWallet(db, ids[1]!, `0x${'1'.repeat(40)}`, 'Loan');
  saveOutcome(db, snapshot, loan.id, {
    status: 'ok',
    holdings: [{ ...holding('DAI', -50, 1), type: 'borrow' }],
    warnings: [],
  });
  finishSnapshot(db, snapshot);
  const logo = db.prepare("INSERT INTO logos (kind, key, file, media_type) VALUES ('token', ?, ?, 'image/png')");
  for (const key of ['BTC', 'UNI', 'PEPE', 'DOGE']) logo.run(key, `${key}.png`);

  const board = boardView(db, ids[1]!, resolveFor);
  assert.deepEqual(
    board.rows.map((r) => r.holdings),
    [
      ['BTC', 'ETH', 'SOL', 'LINK', 'USDC'],
      ['ETH', 'USDC', 'PEPE'],
      ['ETH', 'USDC', 'PEPE'],
    ],
  );
  assert.deepEqual(Object.keys(board.logos).sort(), ['token/BTC', 'token/PEPE']);
});

test(`the board opens at ${BOARD_MINIMUM} portfolios, and people without accounts are not on it`, () => {
  const { db, ids } = seeded(BOARD_MINIMUM - 1);
  const empty = addUser(db, { name: 'Empty', passwordHash: 'x', totpSecret: 'x', totpStep: 0 }).id;

  const mine = boardView(db, ids[0]!, resolveFor);
  assert.equal(mine.open, false);
  assert.equal(mine.portfolios, BOARD_MINIMUM - 1);
  assert.deepEqual(
    mine.rows.map((r) => [r.netWorth, r.you]),
    [[2100.5, true]],
    'until it opens, a person sees only their own row',
  );
  const other = boardView(db, ids[1]!, resolveFor).rows[0]!.key;
  assert.equal(boardPortfolio(db, ids[0]!, other, resolveFor), null, 'nor anyone else’s portfolio');
  assert.equal(boardHistory(db, ids[0]!, other, resolveFor, null), null);
  assert.deepEqual(boardPortfolio(db, ids[0]!, mine.rows[0]!.key, resolveFor)?.board, {
    name: mine.rows[0]!.name,
    rank: null,
    portfolios: BOARD_MINIMUM - 1,
    you: true,
  });
  assert.deepEqual(boardView(db, empty, resolveFor).rows, []);
});

test('leaving the board takes your portfolio off it and theirs out of your sight', () => {
  const { db, ids } = seeded(4);
  const keys = boardView(db, ids[0]!, resolveFor).rows.map((r) => r.key);
  setOnBoard(db, ids[3]!, false);

  const others = boardView(db, ids[0]!, resolveFor);
  assert.equal(others.open, true);
  assert.deepEqual(
    others.rows.map((r) => r.netWorth),
    [6100.5, 4100.5, 2100.5],
  );
  assert.equal(boardPortfolio(db, ids[0]!, keys[0]!, resolveFor), null);

  const left = boardView(db, ids[3]!, resolveFor);
  assert.equal(left.onBoard, false);
  assert.equal(left.open, false);
  assert.equal(left.others, 3);
  assert.deepEqual(
    left.rows.map((r) => [r.netWorth, r.you]),
    [[8100.5, true]],
  );
  assert.equal(boardPortfolio(db, ids[3]!, keys[1]!, resolveFor), null);

  setOnBoard(db, ids[2]!, false);
  assert.equal(boardView(db, ids[0]!, resolveFor).open, false);
});
