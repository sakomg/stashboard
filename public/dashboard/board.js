import { h } from '/common/ui.js';
import { api } from './api.js';
import { showBanner } from './feedback.js';
import { money } from './format.js';
import { logo } from './logos.js';
import { $, actions, state } from './state.js';

const counted = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const accountsText = (row) =>
  [row.wallets && counted(row.wallets, 'wallet'), row.exchanges && counted(row.exchanges, 'exchange')]
    .filter(Boolean)
    .join(', ');

export async function setOnBoard(on) {
  try {
    await api('/api/preferences', { method: 'PUT', body: JSON.stringify({ onBoard: on }) });
  } catch (err) {
    showBanner(err);
  }
  await actions.load();
}

const table = (rows, ranked) =>
  h(
    'table',
    { class: 'board-table' },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', { scope: 'col' }, '#'),
        h('th', { scope: 'col', class: 'left' }, 'Name'),
        h('th', { scope: 'col', class: 'left' }, 'Top holdings'),
        h('th', { scope: 'col', class: 'left optional' }, 'Accounts'),
        h('th', { scope: 'col' }, 'Net worth'),
      ),
    ),
    h(
      'tbody',
      {},
      ...rows.map((row, i) =>
        h(
          'tr',
          {},
          h('td', { class: 'num muted' }, ranked ? String(i + 1) : '—'),
          h(
            'td',
            { class: 'left' },
            h('a', { href: `/board/${row.key}` }, row.name),
            row.you && h('span', { class: 'you-mark' }, 'you'),
          ),
          h(
            'td',
            { class: 'left' },
            h(
              'span',
              { class: 'holdings' },
              ...row.holdings.map((key) =>
                h('span', { class: 'holding', title: key }, logo('token', key), h('span', {}, key)),
              ),
            ),
          ),
          h('td', { class: 'left muted optional' }, accountsText(row)),
          h('td', { class: 'num' }, money(row.netWorth)),
        ),
      ),
    ),
  );

export function renderBoard() {
  const { board } = state;
  if (!board) return;
  if (board.open) {
    $('board').replaceChildren(table(board.rows, true));
    return;
  }
  const n = board.portfolios;
  $('board').replaceChildren(
    board.onBoard
      ? h(
          'p',
          { class: 'empty' },
          h('b', {}, `The board opens when ${board.minimum} people with accounts are on it.`),
          ` ${n} ${n === 1 ? 'is' : 'are'} on it now.`,
        )
      : h(
          'div',
          { class: 'empty board-note' },
          h(
            'p',
            {},
            h('b', {}, 'You are not on the board.'),
            ' Others do not see your portfolio, and you do not see theirs.',
          ),
          h('button', { class: 'button primary', type: 'button', onclick: () => setOnBoard(true) }, 'Join the board'),
        ),
    board.rows.length > 0 && table(board.rows, false),
  );
}
