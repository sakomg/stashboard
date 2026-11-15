import { h, icon, skeleton } from '/common/ui.js';
import { ago, money, units } from './format.js';
import { TYPES, chainLogo, chainName, logo } from './logos.js';
import { $, DUST_USD, firstRead, state } from './state.js';

export function readNote(items) {
  const oldest = items.reduce((min, x) => (x.readAt && (!min || x.readAt < min) ? x.readAt : min), null);
  if (!oldest || Date.now() - Date.parse(oldest) < 30 * 60_000) return null;
  return h(
    'p',
    { class: 'read-at', title: 'Positions in protocols are read less often to stay within the free allowance' },
    icon('clock'),
    `Read ${ago(oldest)}`,
  );
}

export function renderDefi() {
  const byProtocol = new Map();
  for (const x of state.data.holdings) {
    if (!x.protocol || x.kind === 'binance') continue;
    const key = `${x.protocol}\n${x.chain}`;
    if (!byProtocol.has(key)) byProtocol.set(key, []);
    byProtocol.get(key).push(x);
  }
  const protocols = [...byProtocol.values()]
    .map((items) => ({ items, net: items.reduce((s, x) => s + x.value, 0) }))
    .filter((p) => Math.abs(p.net) >= DUST_USD)
    .sort((a, b) => b.net - a.net);

  $('defi-list').replaceChildren(
    ...protocols.map(({ items, net }) =>
      h(
        'article',
        { class: 'protocol' },
        h(
          'div',
          {},
          h('h3', { class: 'name' }, logo('protocol', items[0].protocol), h('span', {}, items[0].protocol)),
          h(
            'p',
            { class: 'where name' },
            chainLogo(items[0].chain),
            h('span', {}, `${chainName(items[0].chain)}, ${[...new Set(items.map((x) => x.account))].join(', ')}`),
          ),
          h('p', { class: 'total num' }, money(net)),
          readNote(items),
        ),
        h(
          'ul',
          {},
          ...items
            .sort((a, b) => b.value - a.value)
            .map((x) =>
              h(
                'li',
                {},
                h('span', { class: 'kind' }, TYPES[x.type] ?? x.type),
                h('span', { class: 'name' }, logo('token', x.asset, x.symbol), h('span', {}, x.symbol)),
                h('span', { class: 'num muted' }, units(x.quantity)),
                h('span', { class: 'num' }, money(x.value)),
              ),
            ),
        ),
      ),
    ),
  );
  if (protocols.length === 0) {
    $('defi-list').replaceChildren(
      firstRead()
        ? skeleton('sk-card')
        : h(
            'p',
            { class: 'empty' },
            'No DeFi positions found. Deposits, loans, staking and rewards in protocols appear here.',
          ),
    );
  }
}
