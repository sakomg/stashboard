import { h } from '/common/ui.js';
import { api } from './api.js';
import { CATEGORY_ORDER, OTHER_COLOR, PALETTE, colorOf } from './colors.js';
import { hideTip, showBanner, showTip } from './feedback.js';
import { inTime, money, percent, usdRound } from './format.js';
import { chainLogoSpec, chainName, isExchange, kindLogoSpec, logo } from './logos.js';
import { $, state } from './state.js';

export const DIMENSIONS = [
  ['category', 'Category', (x) => x.category, null],
  ['asset', 'Asset', (x) => x.asset, (x) => ({ kind: 'token', key: x.asset })],
  ['chain', 'Chain', (x) => chainName(x.chain), (x) => chainLogoSpec(x.chain)],
  ['venue', 'Account', (x) => x.account, (x) => kindLogoSpec(x.kind)],
  ['place', 'Kind', (x) => (isExchange(x.kind) ? 'Exchange' : x.protocol ? 'DeFi' : 'Wallet'), null],
];
export const PERIODS = [
  ['7', '7 d'],
  ['30', '30 d'],
  ['90', '90 d'],
  ['', 'All'],
];
export function groups(dimension) {
  const [, , keyOf, logoOf] = DIMENSIONS.find(([id]) => id === dimension);
  const sums = new Map();
  const samples = new Map();
  for (const x of state.data.holdings) {
    const key = keyOf(x);
    sums.set(key, (sums.get(key) ?? 0) + x.value);
    if (!samples.has(key)) samples.set(key, x);
  }
  const sorted = [...sums].sort((a, b) => b[1] - a[1]);
  const net = sorted.reduce((s, [, v]) => s + v, 0);
  const base = net > 0 ? net : sorted.reduce((s, [, v]) => s + Math.max(v, 0), 0);

  const visible = (name, value) => name !== 'Other' && Math.abs(value) / base >= 0.005;
  const owing = sorted.filter(([name, value]) => value < 0 && visible(name, value)).length;
  const shown = [];
  const owed = [];
  let other = 0;
  for (const [name, value] of sorted) {
    if (value < 0 && visible(name, value)) owed.push({ name, value });
    else if (
      value > 0 &&
      visible(name, value) &&
      shown.length + owing < PALETTE.length &&
      colorOf(dimension, name) !== OTHER_COLOR
    ) {
      shown.push({ name, value });
    } else other += value;
  }
  if (Math.abs(other) / base >= 0.0005) (other > 0 ? shown : owed).push({ name: 'Other', value: other });
  owed.sort((a, b) => a.value - b.value);
  const held = shown.reduce((s, r) => s + r.value, 0);
  return [...shown, ...owed].map((r) => ({
    ...r,
    share: r.value / base,
    slice: r.value > 0 ? r.value / held : 0,
    color: colorOf(dimension, r.name),
    logo: logoOf && r.name !== 'Other' && samples.has(r.name) ? logoOf(samples.get(r.name)) : null,
  }));
}

export const swatchStyle = (r) =>
  r.value < 0 ? { background: 'none', boxShadow: `inset 0 0 0 2px ${r.color}` } : { background: r.color };

export function totals() {
  let held = 0;
  let borrowed = 0;
  for (const { value } of state.data.holdings) {
    if (value > 0) held += value;
    else borrowed -= value;
  }
  return { netWorth: state.data.netWorth, held, borrowed };
}

export function segmented(id, options, current, choose) {
  $(id).replaceChildren(
    ...options.map(([value, label]) =>
      h('button', { type: 'button', 'aria-pressed': String(current === value), onclick: () => choose(value) }, label),
    ),
  );
}

export function renderAllocation() {
  segmented('dimension', DIMENSIONS, state.dimension, (id) => {
    state.dimension = id;
    renderAllocation();
  });

  const rows = groups(state.dimension);
  const strip = $('strip');
  const legend = $('legend');
  const focus = (index) => {
    for (const list of [strip, legend]) {
      list.classList.toggle('focus', index !== null);
      [...list.children].forEach((el, i) => el.classList.toggle('on', i === index));
    }
  };

  strip.replaceChildren(
    ...rows
      .filter((r) => r.slice > 0)
      .map((r, i) =>
        h('span', {
          style: { flex: `${r.slice} 1 0`, background: r.color },
          onmousemove: (e) => {
            focus(i);
            showTip(e, r.name, `${money(r.value)}, ${percent(r.share)}`);
          },
          onmouseleave: () => {
            focus(null);
            hideTip();
          },
        }),
      ),
  );
  strip.setAttribute('aria-label', `Allocation: ${rows.map((r) => `${r.name} ${percent(r.share)}`).join(', ')}`);

  legend.replaceChildren(
    ...rows.map((r, i) =>
      h(
        'li',
        { onmouseenter: () => focus(i), onmouseleave: () => focus(null) },
        h('span', { class: 'swatch', style: swatchStyle(r) }),
        h('span', { class: 'name' }, r.logo && logo(r.logo.kind, r.logo.key, r.name), h('span', {}, r.name)),
        h('span', { class: 'num' }, money(r.value)),
        h('span', { class: 'num share' }, percent(r.share)),
      ),
    ),
  );

  const top = state.data.assets.filter((a) => a.value > 0).slice(0, 5);
  const stable = state.data.assets.filter((a) => a.category === 'Stablecoins').reduce((s, a) => s + a.value, 0);
  $('allocation-notes').replaceChildren(
    h('h3', {}, 'Largest positions'),
    h(
      'ol',
      {},
      ...top.map((a) =>
        h(
          'li',
          {},
          h('span', { class: 'name' }, logo('token', a.key), h('span', {}, a.key)),
          h('span', { class: 'num muted' }, percent(a.share)),
        ),
      ),
    ),
    h('h3', {}, 'Held in stablecoins'),
    h('p', { class: 'stable num' }, state.data.netWorth ? percent(stable / state.data.netWorth) : '—'),
  );
}

export let chart;

export async function renderHistory() {
  segmented('period', PERIODS, state.period, (id) => {
    state.period = id;
    renderHistory().catch(showBanner);
  });

  const points = await api(`/api/history${state.period ? `?days=${state.period}` : ''}`);
  const enough = points.length >= 2;
  $('history').hidden = !enough;
  $('history-empty').hidden = enough;
  if (!enough) {
    const { updatedAt, collectEveryMinutes } = state.data;
    const due = updatedAt ? Date.parse(updatedAt) + collectEveryMinutes * 60_000 - Date.now() : null;
    $('history-empty').replaceChildren(
      h('span', { class: 'ghost-line', 'aria-hidden': 'true' }),
      h(
        'span',
        {},
        h('b', {}, 'History starts with the next update'),
        due === null ? '.' : due > 60_000 ? `, due in about ${inTime(due)}.` : ', due any minute now.',
        ' Every update adds a point, so this chart fills in on its own.',
      ),
    );
    return;
  }
  if (!chart) $('history').replaceChildren();

  const peak = Math.max(...points.map((p) => p.total), 0);
  const present = new Set(
    points
      .flatMap((p) => Object.keys(p.categories))
      .filter((name) => points.some((p) => (p.categories[name] ?? 0) >= peak * 0.001)),
  );
  const names = [
    ...CATEGORY_ORDER.filter((n) => present.has(n)),
    ...[...present].filter((n) => !CATEGORY_ORDER.includes(n)),
  ];
  const css = getComputedStyle(document.documentElement);
  const token = (name) => css.getPropertyValue(name).trim();

  chart ??= echarts.init($('history'), null, { renderer: 'svg' });
  chart.setOption(
    {
      animation: false,
      textStyle: { fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", color: token('--slate') },
      grid: { left: 10, right: 8, top: 44, bottom: 0, containLabel: true },
      legend: {
        top: 0,
        left: 0,
        icon: 'roundRect',
        itemWidth: 12,
        itemHeight: 12,
        textStyle: { color: token('--slate') },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: token('--raised'),
        borderColor: token('--line'),
        textStyle: { color: token('--bone'), fontSize: 13 },
        valueFormatter: (v) => money(v),
        axisPointer: { lineStyle: { color: token('--dim') } },
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: token('--line') } },
        axisTick: { show: false },
        axisLabel: { color: token('--slate'), hideOverlap: true },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: token('--slate'), formatter: (v) => (state.hideAmounts ? '' : usdRound(v)) },
        splitLine: { lineStyle: { color: token('--line') } },
      },
      series: names.map((name) => ({
        name,
        type: 'line',
        stack: 'total',
        showSymbol: false,
        lineStyle: { width: 2, color: token('--ink') },
        areaStyle: { opacity: 1, color: colorOf('category', name) },
        itemStyle: { color: colorOf('category', name) },
        emphasis: { disabled: true },
        data: points.map((p) => [p.time, Math.max(p.categories[name] ?? 0, 0)]),
      })),
    },
    true,
  );
  chart.resize();
}

window.addEventListener('resize', () => chart?.resize());
