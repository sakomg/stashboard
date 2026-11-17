import { h, help } from '/common/ui.js';
import { ago, dash, fixed, percent, signedPercent } from './format.js';
import { ZONES, heatBadge } from './heat.js';
import { HELP } from './help.js';
import { logo } from './logos.js';
import { $, DUST_USD, state } from './state.js';

const READING_HELP = {
  rsiDaily: HELP.rsi,
  rsiWeekly: HELP.rsiWeekly,
  funding: HELP.funding,
  ma200: HELP.ma200,
  oiGrowth: HELP.openInterest,
};
const READING_NAMES = {
  rsiDaily: 'Daily RSI',
  rsiWeekly: 'Weekly RSI',
  funding: 'Funding',
  ma200: 'Price against 200-day average',
  oiGrowth: 'Open interest',
};
const SIGNAL_COLUMNS = [
  ['rsiDaily', 'Daily RSI', (v) => v.toFixed(0), ''],
  ['rsiWeekly', 'Weekly RSI', (v) => v.toFixed(0), 'optional'],
  ['funding', 'Funding', (v) => `${fixed(v, 3)}%`, 'optional'],
  ['ma200', 'vs 200-day', signedPercent, 'optional'],
  ['oiGrowth', 'Open interest 7 d', signedPercent, 'optional'],
];
const ZONE_ORDER = ['cold', 'neutral', 'warm', 'overheated'];

export function renderSignals() {
  const { assets, heat } = state.data;
  const scored = assets.filter((a) => a.signal && Math.abs(a.value) >= DUST_USD);
  const inZone = (zone) => scored.filter((a) => a.signal.zone === zone);
  const shareOf = (list) => list.reduce((s, a) => s + Math.max(0, a.share), 0);
  const newest = scored.reduce((max, a) => (a.signal.time > max ? a.signal.time : max), '');
  const { weights, zones } = heat;
  const total = Object.values(weights).reduce((s, w) => s + w, 0) || 1;
  const ranges = {
    cold: [0, zones.neutral],
    neutral: [zones.neutral, zones.warm],
    warm: [zones.warm, zones.overheated],
    overheated: [zones.overheated, 100],
  };
  if (state.signalZone && inZone(state.signalZone).length === 0) state.signalZone = null;

  const hot = shareOf(inZone('overheated'));
  const warm = shareOf(inZone('warm'));
  const cold = shareOf(inZone('cold'));
  const unscored = Math.max(0, 1 - shareOf(scored));
  const summary = scored.length
    ? [
        hot > 0 ? `${percent(hot)} of the portfolio is overheated.` : 'Nothing in the portfolio is overheated.',
        warm > 0 ? `${percent(warm)} is warm.` : '',
        cold > 0 ? `${percent(cold)} is cold.` : '',
        unscored > 0.005
          ? `${percent(unscored)} has no market readings: stablecoins and tokens without a Binance market.`
          : '',
      ]
        .filter(Boolean)
        .join(' ')
    : 'Signals appear a few minutes after the first update.';

  $('heat-guide').replaceChildren(
    h(
      'div',
      { class: 'guide-head' },
      h('p', {}, summary),
      h('span', { class: 'muted' }, newest ? `Updated ${ago(newest)}` : ''),
    ),
    h(
      'div',
      { class: 'heat-scale', role: 'group', 'aria-label': 'Show assets by zone' },
      ZONE_ORDER.map((zone) => {
        const [from, to] = ranges[zone];
        const list = inZone(zone);
        return h(
          'button',
          {
            type: 'button',
            class: `band ${zone}`,
            style: { flex: `${to - from} 1 0` },
            'aria-pressed': String(state.signalZone === zone),
            disabled: list.length === 0,
            title: list.length ? `Show only ${ZONES[zone].toLowerCase()} assets` : null,
            onclick: () => {
              state.signalZone = state.signalZone === zone ? null : zone;
              renderSignals();
            },
          },
          h('span', { class: 'bar' }),
          h('span', { class: 'label' }, h('b', {}, ZONES[zone]), h('small', { class: 'num' }, `${from}–${to}`)),
          h(
            'span',
            { class: 'stat' },
            h('b', { class: 'num' }, list.length ? percent(shareOf(list)) : '—'),
            h('small', {}, list.length ? `${list.length} ${list.length === 1 ? 'asset' : 'assets'}` : 'none'),
          ),
        );
      }),
    ),
    h(
      'div',
      { class: 'guide-foot' },
      h('span', { class: 'muted' }, 'Score built from'),
      h(
        'ul',
        { class: 'readings' },
        Object.entries(weights).map(([name, weight]) =>
          h(
            'li',
            {},
            h('span', {}, READING_NAMES[name] ?? name),
            h('b', { class: 'num' }, `${Math.round((weight / total) * 100)}%`),
            READING_HELP[name] && help(READING_HELP[name]),
          ),
        ),
      ),
    ),
  );

  const rows = (state.signalZone ? inZone(state.signalZone) : scored).sort(
    (a, b) => b.signal.score - a.signal.score || b.share - a.share,
  );
  const table = $('signal-table');
  table.tHead.replaceChildren(
    h(
      'tr',
      {},
      h('th', { scope: 'col' }, 'Asset'),
      h('th', { scope: 'col', class: 'optional' }, 'Share'),
      h('th', { scope: 'col' }, 'Heat', help(HELP.heat)),
      SIGNAL_COLUMNS.map(([name, label, , cls]) =>
        h('th', { scope: 'col', class: cls }, label, READING_HELP[name] && help(READING_HELP[name])),
      ),
    ),
  );
  table.tBodies[0].replaceChildren(
    ...rows.map((a) => {
      const reading = new Map(a.signal.components.map((c) => [c.name, c]));
      return h(
        'tr',
        {},
        h('td', {}, h('span', { class: 'name' }, logo('token', a.key), h('b', {}, a.key))),
        h('td', { class: 'num optional' }, percent(a.share)),
        h('td', {}, heatBadge(a.signal)),
        SIGNAL_COLUMNS.map(([name, , format, cls]) => {
          const c = reading.get(name);
          if (!c) return h('td', { class: `num ${cls}` }, dash());
          const tone = c.score >= 80 ? 'hot' : c.score <= 30 ? 'cool' : '';
          return h(
            'td',
            {
              class: `num ${cls} ${tone}`,
              title: tone ? `${READING_NAMES[name]} reads ${tone === 'hot' ? 'overheated' : 'cold'} on its own` : null,
            },
            format(c.value),
          );
        }),
      );
    }),
  );
  if (rows.length === 0) {
    table.tBodies[0].append(
      h('tr', {}, h('td', { colspan: SIGNAL_COLUMNS.length + 3, class: 'muted' }, 'No asset has a heat score yet.')),
    );
  }
}
