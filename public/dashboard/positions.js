import { h, help, icon, skeleton } from '/common/ui.js';
import { colorOf } from './colors.js';
import { openCategory } from './dialogs.js';
import { change, money, percent, price, units } from './format.js';
import { heatBadge } from './heat.js';
import { HELP } from './help.js';
import { TYPES, chainLogo, chainName, isExchange, kindLogo, logo } from './logos.js';
import { $, DUST_USD, firstRead, hasBalances, state } from './state.js';

const COLUMNS = [
  ['key', 'Asset', '', (a) => a.key],
  ['quantity', 'Quantity', 'optional', (a) => a.quantity],
  ['price', 'Price', 'optional', (a) => a.price],
  ['value', 'Value', '', (a) => a.value],
  ['share', 'Share', 'optional', (a) => a.share],
  ['change1d', '24 h', '', (a) => a.change1d],
  ['change7d', '7 d', 'optional', (a) => a.change7d],
  ['heat', 'Heat', '', (a) => a.signal?.score ?? null, HELP.heat],
];

export function renderPositions() {
  const { data, sort } = state;
  const table = $('positions-table');

  table.tHead.replaceChildren(
    h(
      'tr',
      {},
      ...COLUMNS.map(([key, label, cls, , about]) => {
        const active = sort.key === key;
        return h(
          'th',
          { class: cls, scope: 'col', 'aria-sort': active ? (sort.descending ? 'descending' : 'ascending') : null },
          h(
            'button',
            {
              type: 'button',
              onclick: () => {
                state.sort = { key, descending: active ? !sort.descending : key !== 'key' };
                renderPositions();
              },
            },
            label,
            active && icon(sort.descending ? 'arrow-down' : 'arrow-up'),
          ),
          about && help(about),
        );
      }),
    ),
  );

  const dust = data.assets.filter((a) => Math.abs(a.value) < DUST_USD);
  const visible = state.showDust ? data.assets : data.assets.filter((a) => Math.abs(a.value) >= DUST_USD);
  const valueOf = COLUMNS.find(([key]) => key === sort.key)[3];
  const sorted = [...visible].sort((a, b) => {
    const [x, y] = [valueOf(a), valueOf(b)];
    const order = typeof x === 'string' ? x.localeCompare(y) : (x ?? -Infinity) - (y ?? -Infinity);
    return sort.descending ? -order : order;
  });

  const toggle = $('dust-toggle');
  toggle.hidden = dust.length === 0;
  toggle.textContent = state.showDust
    ? `Hide positions under $${DUST_USD}`
    : `Show ${dust.length} positions under $${DUST_USD}`;

  const largest = Math.max(...visible.map((a) => a.share), 0);
  const body = table.tBodies[0];
  body.replaceChildren();
  for (const a of sorted) {
    const open = state.expanded.has(a.key);
    const flip = () => {
      if (open) state.expanded.delete(a.key);
      else state.expanded.add(a.key);
      renderPositions();
    };
    body.append(
      h(
        'tr',
        { class: 'position', 'aria-expanded': String(open), onclick: flip },
        h(
          'td',
          {},
          h(
            'div',
            { class: 'asset' },
            h('span', { class: 'chevron' }, icon('chevron-right')),
            logo('token', a.key),
            h(
              'button',
              {
                type: 'button',
                'aria-label': `${a.key}: ${open ? 'hide' : 'show'} where it is held`,
                onclick: (e) => {
                  e.stopPropagation();
                  flip();
                },
              },
              a.key,
            ),
            h(
              'button',
              {
                class: 'category optional',
                type: 'button',
                title: 'Change category',
                'aria-label': `${a.key} is in ${a.category}. Change category`,
                onclick: (e) => {
                  e.stopPropagation();
                  openCategory(a);
                },
              },
              h('span', { class: 'swatch small', style: { background: colorOf('category', a.category) } }),
              a.category,
            ),
          ),
        ),
        h('td', { class: 'num optional' }, units(a.quantity)),
        h('td', { class: 'num optional' }, price(a.price)),
        h('td', { class: 'num' }, money(a.value)),
        h(
          'td',
          { class: 'optional' },
          h(
            'span',
            { class: 'share-cell' },
            h(
              'span',
              { class: 'share-bar' },
              h('i', { style: { width: `${largest > 0 ? Math.max(0, a.share / largest) * 100 : 0}%` } }),
            ),
            h('span', { class: 'num' }, percent(a.share)),
          ),
        ),
        h('td', {}, change(a.change1d)),
        h('td', { class: 'optional' }, change(a.change7d)),
        h('td', {}, heatBadge(a.signal)),
      ),
    );
    if (open) body.append(placesRow(a.key));
  }
  if (sorted.length === 0) {
    body.append(
      ...(firstRead()
        ? Array.from({ length: 6 }, () =>
            h('tr', { class: 'sk-row' }, h('td', { colspan: COLUMNS.length }, skeleton('sk-line wide'))),
          )
        : [
            h(
              'tr',
              {},
              h(
                'td',
                { colspan: COLUMNS.length, class: 'muted' },
                hasBalances()
                  ? 'Nothing here is worth a dollar or more.'
                  : 'No positions yet. They appear after the next update.',
              ),
            ),
          ]),
    );
  }
}

const CENT = 0.005;

function placesRow(asset) {
  const all = state.data.holdings.filter((x) => x.asset === asset).sort((a, b) => b.value - a.value);
  const places = all.filter((x) => Math.abs(x.value) >= CENT);
  const tiny = all.length - places.length;
  return h(
    'tr',
    { class: 'places' },
    h(
      'td',
      { colspan: COLUMNS.length },
      h(
        'div',
        { class: 'places-card' },
        h(
          'table',
          {},
          h(
            'thead',
            {},
            h(
              'tr',
              {},
              ...['Account', 'Where', 'Held as', 'Quantity', 'Value'].map((t) => h('th', { scope: 'col' }, t)),
            ),
          ),
          h(
            'tbody',
            {},
            ...places.map((x) =>
              h(
                'tr',
                {},
                h('td', {}, h('span', { class: 'name' }, kindLogo(x.kind), h('span', {}, x.account))),
                h(
                  'td',
                  {},
                  isExchange(x.kind)
                    ? x.protocol
                    : h(
                        'span',
                        { class: 'name' },
                        chainLogo(x.chain),
                        h('span', {}, [chainName(x.chain), x.protocol].filter(Boolean).join(', ')),
                      ),
                ),
                h('td', {}, `${TYPES[x.type] ?? x.type}${x.symbol !== asset ? ` (${x.symbol})` : ''}`),
                h('td', { class: 'num' }, units(x.quantity)),
                h('td', { class: 'num' }, money(x.value)),
              ),
            ),
          ),
        ),
        tiny > 0 &&
          h(
            'p',
            { class: 'places-more' },
            `${tiny} more ${tiny === 1 ? 'place holds' : 'places hold'} less than a cent.`,
          ),
      ),
    ),
  );
}

$('dust-toggle').addEventListener('click', () => {
  state.showDust = !state.showDust;
  renderPositions();
});
