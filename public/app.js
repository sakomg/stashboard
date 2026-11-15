// Dashboard client. No build step: plain ES module, DOM built by hand.
// Token names and symbols come from public chains and can contain anything, so nothing here uses innerHTML.

const $ = (id) => document.getElementById(id);

/** h('td', { class: 'num' }, 'text', childNode) */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === false || value == null) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'style') Object.assign(el.style, value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.filter((c) => c != null && c !== false));
  return el;
}

// ── Icons and logos ──────────────────────────────────────────────────────────

const SVG = 'http://www.w3.org/2000/svg';

/** An interface icon from the sprite. Decorative: the control that holds it carries the label. */
function icon(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `/icons.svg#${name}`);
  svg.append(use);
  return svg;
}

/** A button that shows only an icon; the label is read out and shown on hover. */
const iconButton = (name, label, onclick, cls = '') =>
  h('button', { class: `icon-button ${cls}`, type: 'button', 'aria-label': label, title: label, onclick }, icon(name));

/** The first letters of a name, shown where there is no logo. */
function monogram(label) {
  return h(
    'span',
    { class: 'logo mono', 'aria-hidden': 'true' },
    String(label)
      .replace(/[^\p{L}\p{N}]/gu, '')
      .slice(0, 2)
      .toUpperCase() || '?',
  );
}

/** A logo the server has stored, or a monogram when it has none or the image fails to load. */
function logo(kind, key, label = key) {
  const version = state.logos.get(`${kind}/${key}`);
  if (!version) return monogram(label);
  const img = h('img', {
    class: 'logo',
    src: `/logo/${kind}/${encodeURIComponent(key)}?v=${version}`,
    alt: '',
    width: 20,
    height: 20,
    loading: 'lazy',
  });
  img.addEventListener('error', () => img.replaceWith(monogram(label)));
  return img;
}

// Accounts and the two non-EVM venues are drawn with the logo of their native coin.
const KIND_TOKEN = { binance: 'BNB', evm: 'ETH', solana: 'SOL', ton: 'TON' };
const CHAIN_TOKEN = { binance: 'BNB', ton: 'TON' };
const kindLogo = (kind) => logo('token', KIND_TOKEN[kind], KINDS[kind]);
const chainLogo = (id) =>
  CHAIN_TOKEN[id] ? logo('token', CHAIN_TOKEN[id], chainName(id)) : logo('chain', id, chainName(id));

// ── Formatting ───────────────────────────────────────────────────────────────

const usd = (n) =>
  `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usdRound = (n) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const quantity = (n) => n.toLocaleString('en-US', { maximumSignificantDigits: 6 });
const price = (n) => (n == null ? '—' : `$${n.toLocaleString('en-US', { maximumSignificantDigits: 5 })}`);
// Rounds first, so a tiny negative number does not print as "-0.000".
const fixed = (n, digits) =>
  (Number(n.toFixed(digits)) === 0 ? (0).toFixed(digits) : n.toFixed(digits)).replace('-', '−');
const percent = (n) => `${(n * 100).toFixed(1)}%`;
const dash = () => h('span', { class: 'muted' }, '—');

function change(n) {
  if (n == null) return h('span', { class: 'num muted' }, '—');
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return h(
    'span',
    { class: `num ${n > 0 ? 'up' : n < 0 ? 'down' : 'muted'}` },
    `${sign}${Math.abs(n * 100).toFixed(1)}%`,
  );
}

function ago(iso) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
}

const KINDS = { binance: 'Binance', evm: 'EVM', solana: 'Solana', ton: 'TON' };
const TYPES = {
  wallet: 'Wallet',
  earn: 'Earn',
  staked: 'Staked',
  deposit: 'Deposited',
  borrow: 'Borrowed',
  lp: 'Liquidity',
  futures: 'Futures',
  margin: 'Margin',
  locked: 'Locked',
  reward: 'Reward',
};
const CHAINS = { binance: 'Binance', ton: 'TON' };
const chainName = (id) =>
  CHAINS[id] ??
  state.chainNames[id] ??
  id.replace(/(^|-)(\w)/g, (_, hyphen, c) => (hyphen ? ' ' : '') + c.toUpperCase());

// ── Colour ───────────────────────────────────────────────────────────────────
// Eight categorical hues validated for this dark surface, used in this fixed order; a ninth group is "Other".
// Colour follows the group, not its rank: a category keeps its hue whatever its size.

const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];
const OTHER_COLOR = '#6b7480';
const CATEGORY_ORDER = ['L1', 'BTC', 'Stablecoins', 'Memes', 'DeFi', 'Stocks', 'ETH', 'L2'];
const assigned = { category: new Map(CATEGORY_ORDER.map((name, i) => [name, PALETTE[i]])) };

function colorOf(dimension, name) {
  if (name === 'Other') return OTHER_COLOR;
  const map = (assigned[dimension] ??= new Map());
  if (!map.has(name)) map.set(name, map.size < PALETTE.length ? PALETTE[map.size] : OTHER_COLOR);
  return map.get(name);
}

// ── State ────────────────────────────────────────────────────────────────────

// [id, label, group of a holding, logo of a group given one of its holdings]
const DIMENSIONS = [
  ['category', 'Category', (x) => x.category, null],
  ['asset', 'Asset', (x) => x.asset, (x) => logo('token', x.asset)],
  ['chain', 'Chain', (x) => chainName(x.chain), (x) => chainLogo(x.chain)],
  ['venue', 'Account', (x) => x.account, (x) => kindLogo(x.kind)],
  ['place', 'Kind', (x) => (x.kind === 'binance' ? 'Exchange' : x.protocol ? 'DeFi' : 'Wallet'), null],
];
const PERIODS = [
  ['7', '7 d'],
  ['30', '30 d'],
  ['90', '90 d'],
  ['', 'All'],
];
const DUST_USD = 1;

const state = {
  data: null,
  build: null,
  logos: new Map(),
  chainNames: {},
  dimension: 'category',
  period: '30',
  sort: { key: 'value', descending: true },
  expanded: new Set(),
  showDust: false,
  renaming: null,
  updating: false,
};

async function api(path, options) {
  let response;
  try {
    response = await fetch(path, options && { ...options, headers: { 'content-type': 'application/json' } });
  } catch {
    throw new Error('The server did not answer. Check the connection.');
  }
  // The session ended or was never there: the sign-in page is the only useful place to be.
  if (response.status === 401) {
    location.replace('/login');
    return new Promise(() => {});
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

// ── Summary ──────────────────────────────────────────────────────────────────

function renderSummary() {
  const { data } = state;
  const [whole, cents] = usd(data.netWorth).split('.');
  $('net-worth').replaceChildren(whole, h('span', { class: 'cents' }, `.${cents}`));

  const busy = state.updating || data.collecting;
  $('updated').textContent = busy ? 'Updating…' : data.updatedAt ? `Updated ${ago(data.updatedAt)}` : 'Not updated yet';
  const button = $('collect');
  button.disabled = busy;
  button.classList.toggle('spinning', busy);
  button.title = busy ? 'Updating…' : `Update now. Updates on its own every ${data.collectEveryMinutes} min.`;

  const fact = (label, ...value) => h('div', {}, h('dt', {}, label), h('dd', {}, ...value));
  $('facts').replaceChildren(
    fact('24 hours', change(data.changes.d1)),
    fact('7 days', change(data.changes.d7)),
    fact('30 days', change(data.changes.d30)),
    data.fearGreed && fact('Fear & Greed', String(data.fearGreed.value), h('small', {}, data.fearGreed.label)),
  );
  $('sign-out').hidden = !data.loginEnabled;

  $('sources').replaceChildren(
    ...data.sources.map((s) => {
      const problem =
        s.status === null ? ['clock', 'Not read yet'] : s.stale ? ['triangle-alert', 'Out of date'] : null;
      return h(
        'li',
        {
          class: problem ? 'problem' : '',
          title: problem ? problem[1] : `${usd(s.value)}, updated ${ago(s.collectedAt)}`,
        },
        kindLogo(s.kind),
        h('span', { class: 'chip-label' }, s.label),
        !problem && h('span', { class: 'num muted' }, usdRound(s.value)),
        problem && icon(problem[0]),
        problem && h('span', { class: 'sr-only' }, problem[1]),
      );
    }),
  );

  // What went wrong, said once and in full, instead of a tooltip nobody finds.
  $('notices').replaceChildren(
    ...data.sources
      .filter((s) => s.stale)
      .map((s) =>
        h(
          'li',
          {},
          icon('triangle-alert'),
          h(
            'span',
            {},
            h('b', {}, s.label),
            s.collectedAt
              ? ` could not be updated. Showing its balances from ${ago(s.collectedAt)}. `
              : ' could not be read, so it is missing from the totals. ',
            h('span', { class: 'muted' }, s.error ?? ''),
          ),
        ),
      ),
  );
}

// ── Allocation ───────────────────────────────────────────────────────────────

function groups(dimension) {
  const [, , keyOf, logoOf] = DIMENSIONS.find(([id]) => id === dimension);
  const totals = new Map();
  const samples = new Map();
  // Debts are left out: a strip can only divide up what is held.
  for (const x of state.data.holdings) {
    if (x.value <= 0) continue;
    const key = keyOf(x);
    totals.set(key, (totals.get(key) ?? 0) + x.value);
    if (!samples.has(key)) samples.set(key, x);
  }
  const sorted = [...totals].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, v]) => s + v, 0);

  // Keep what has a colour of its own and is wide enough to see; the rest folds into "Other".
  const shown = [];
  let other = 0;
  for (const [name, value] of sorted) {
    if (
      name !== 'Other' &&
      shown.length < PALETTE.length &&
      value / total >= 0.005 &&
      colorOf(dimension, name) !== OTHER_COLOR
    ) {
      shown.push({ name, value });
    } else {
      other += value;
    }
  }
  if (other > 0) shown.push({ name: 'Other', value: other });
  return shown.map((r) => ({
    ...r,
    share: r.value / total,
    color: colorOf(dimension, r.name),
    logo: logoOf && r.name !== 'Other' && samples.has(r.name) ? logoOf(samples.get(r.name)) : null,
  }));
}

function segmented(id, options, current, choose) {
  $(id).replaceChildren(
    ...options.map(([value, label]) =>
      h('button', { type: 'button', 'aria-pressed': String(current === value), onclick: () => choose(value) }, label),
    ),
  );
}

function renderAllocation() {
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
    ...rows.map((r, i) =>
      h('span', {
        style: { flex: `${r.share} 1 0`, background: r.color },
        onmousemove: (e) => {
          focus(i);
          showTip(e, r.name, `${usd(r.value)}, ${percent(r.share)}`);
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
        h('span', { class: 'swatch', style: { background: r.color } }),
        h('span', { class: 'name' }, r.logo, h('span', {}, r.name)),
        h('span', { class: 'num' }, usd(r.value)),
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

// ── History ──────────────────────────────────────────────────────────────────

let chart;

async function renderHistory() {
  segmented('period', PERIODS, state.period, (id) => {
    state.period = id;
    renderHistory().catch(showBanner);
  });

  const points = await api(`/api/history${state.period ? `?days=${state.period}` : ''}`);
  const enough = points.length >= 2;
  $('history').hidden = !enough;
  $('history-empty').hidden = enough;
  if (!enough) {
    $('history-empty').textContent =
      'History appears after the second update. Stashboard records the portfolio on every update, so this chart fills in on its own.';
    return;
  }

  const present = new Set(points.flatMap((p) => Object.keys(p.categories)));
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
      textStyle: { fontFamily: token('--body'), color: token('--slate') },
      grid: { left: 0, right: 8, top: 44, bottom: 0, containLabel: true },
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
        valueFormatter: (v) => usd(v),
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
        axisLabel: { color: token('--slate'), formatter: (v) => usdRound(v) },
        splitLine: { lineStyle: { color: token('--line') } },
      },
      series: names.map((name) => ({
        name,
        type: 'line',
        stack: 'total',
        showSymbol: false,
        // A surface-coloured edge keeps neighbouring bands apart without relying on hue alone.
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

// ── Positions ────────────────────────────────────────────────────────────────

const reading = (a, name) => a.signal?.components.find((c) => c.name === name)?.value ?? null;

// [sort key, label, class, value to sort by]
const COLUMNS = [
  ['key', 'Asset', '', (a) => a.key],
  ['quantity', 'Quantity', 'optional', (a) => a.quantity],
  ['price', 'Price', 'optional', (a) => a.price],
  ['value', 'Value', '', (a) => a.value],
  ['share', 'Share', '', (a) => a.share],
  ['change1d', '24 h', '', (a) => a.change1d],
  ['change7d', '7 d', 'optional', (a) => a.change7d],
  ['rsi', 'RSI', 'optional', (a) => reading(a, 'rsiDaily')],
  ['funding', 'Funding', 'optional', (a) => reading(a, 'funding')],
  ['heat', 'Heat', '', (a) => a.signal?.score ?? null],
];

const ZONES = { cold: 'Cold', neutral: 'Neutral', warm: 'Warm', overheated: 'Overheated' };
const READINGS = {
  rsiDaily: ['Daily RSI', (v) => v.toFixed(0)],
  rsiWeekly: ['Weekly RSI', (v) => v.toFixed(0)],
  funding: ['Funding', (v) => `${fixed(v, 4)}% per 8 h`],
  ma200: ['Price against its 200-day average', (v) => `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}%`],
  oiGrowth: ['Open interest over 7 days', (v) => `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(0)}%`],
};

/** The heat score with its zone spelled out, so the colour is never the only cue. */
function heatBadge(signal) {
  if (!signal) return dash();
  return h(
    'span',
    { class: `heat ${signal.zone}`, title: `Heat ${signal.score.toFixed(0)} of 100, from ${signal.pair}` },
    h('b', { class: 'num' }, signal.score.toFixed(0)),
    ZONES[signal.zone],
  );
}

function renderPositions() {
  const { data, sort } = state;
  const table = $('positions');

  table.tHead.replaceChildren(
    h(
      'tr',
      {},
      ...COLUMNS.map(([key, label, cls]) => {
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

  // Bars compare positions with each other, so the largest one fills the track.
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
    const funding = reading(a, 'funding');
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
              'span',
              { class: 'category optional' },
              h('span', { class: 'swatch small', style: { background: colorOf('category', a.category) } }),
              a.category,
            ),
          ),
        ),
        h('td', { class: 'num optional' }, quantity(a.quantity)),
        h('td', { class: 'num optional' }, price(a.price)),
        h('td', { class: 'num' }, usd(a.value)),
        h(
          'td',
          {},
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
        h('td', { class: 'num optional' }, reading(a, 'rsiDaily')?.toFixed(0) ?? dash()),
        h('td', { class: 'num optional' }, funding === null ? dash() : `${fixed(funding, 3)}%`),
        h('td', {}, heatBadge(a.signal)),
      ),
    );
    if (open) body.append(placesRow(a.key));
  }
  if (sorted.length === 0) {
    body.append(h('tr', {}, h('td', { colspan: COLUMNS.length, class: 'muted' }, 'No positions yet.')));
  }
}

/** Where one asset is held: every account, chain and protocol it sits in. */
function placesRow(asset) {
  const places = state.data.holdings.filter((x) => x.asset === asset).sort((a, b) => b.value - a.value);
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
                  x.kind === 'binance'
                    ? x.protocol
                    : h(
                        'span',
                        { class: 'name' },
                        chainLogo(x.chain),
                        h('span', {}, [chainName(x.chain), x.protocol].filter(Boolean).join(', ')),
                      ),
                ),
                h('td', {}, `${TYPES[x.type] ?? x.type}${x.symbol !== asset ? ` (${x.symbol})` : ''}`),
                h('td', { class: 'num' }, quantity(x.quantity)),
                h('td', { class: 'num' }, usd(x.value)),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

$('dust-toggle').addEventListener('click', () => {
  state.showDust = !state.showDust;
  renderPositions();
});

// ── Signals ──────────────────────────────────────────────────────────────────

function renderSignals() {
  const scored = state.data.assets.filter((a) => a.signal && Math.abs(a.value) >= DUST_USD);
  // Largest holdings first: an overheated 10% position matters more than an overheated 0.5% one.
  const list = (zone) => scored.filter((a) => a.signal.zone === zone).sort((a, b) => b.share - a.share);
  const column = (title, zone, empty, fired) => {
    const assets = list(zone);
    return h(
      'div',
      {},
      h('h3', {}, title),
      assets.length === 0
        ? h('p', { class: 'muted' }, empty)
        : h(
            'ul',
            {},
            ...assets.map((a) => {
              const reasons = a.signal.components.filter(fired).map((c) => {
                const [label, format] = READINGS[c.name];
                return `${label} ${format(c.value)}`;
              });
              return h(
                'li',
                {},
                h(
                  'span',
                  { class: 'who' },
                  logo('token', a.key),
                  h('b', {}, a.key),
                  h('span', { class: 'num muted' }, percent(a.share)),
                ),
                heatBadge(a.signal),
                h(
                  'p',
                  { class: 'muted' },
                  reasons.length
                    ? reasons.join('; ')
                    : 'No single reading stands out; the score is the sum of small ones.',
                ),
              );
            }),
          ),
    );
  };

  $('signals').replaceChildren(
    column('Overheated', 'overheated', 'Nothing in the portfolio is overheated.', (c) => c.score >= 80),
    column('Cold', 'cold', 'Nothing in the portfolio is cold.', (c) => c.score <= 30),
  );
  const newest = scored.reduce((max, a) => (a.signal.time > max ? a.signal.time : max), '');
  $('signals-note').textContent = newest
    ? `Heat runs from 0 (cold) to 100 (overheated) and blends RSI, funding, distance from the 200-day average and open interest. Updated ${ago(newest)}.`
    : 'Signals appear a few minutes after the first update.';
}

// ── DeFi ─────────────────────────────────────────────────────────────────────

function renderDefi() {
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

  $('defi').replaceChildren(
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
          h('p', { class: 'total num' }, usd(net)),
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
                h('span', { class: 'num muted' }, quantity(x.quantity)),
                h('span', { class: 'num' }, usd(x.value)),
              ),
            ),
        ),
      ),
    ),
  );
  if (protocols.length === 0) {
    $('defi').replaceChildren(
      h(
        'p',
        { class: 'empty' },
        'No DeFi positions found. Deposits, loans, staking and rewards in protocols appear here.',
      ),
    );
  }
}

// ── Wallets ──────────────────────────────────────────────────────────────────

function renderWallets() {
  const wallets = state.data.sources.filter((s) => s.kind !== 'binance');
  $('wallets-section').hidden = wallets.length === 0;

  $('wallets').replaceChildren(
    ...wallets.map((w) => {
      if (state.renaming !== w.id) {
        return h(
          'li',
          {},
          h('span', { class: 'label name' }, kindLogo(w.kind), h('span', {}, w.label)),
          h('span', { class: 'kind muted' }, KINDS[w.kind]),
          h('span', { class: 'address num muted' }, w.address),
          h('span', { class: 'num' }, w.status === null ? '—' : usd(w.value)),
          h(
            'span',
            { class: 'actions' },
            iconButton('pencil', `Rename ${w.label}`, () => {
              state.renaming = w.id;
              renderWallets();
            }),
            iconButton('trash-2', `Remove ${w.label}`, () => openRemove(w)),
          ),
        );
      }

      const input = h('input', { value: w.label, maxlength: 40, 'aria-label': 'Wallet name' });
      const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
      const cancel = () => {
        state.renaming = null;
        renderWallets();
      };
      const save = async () => {
        try {
          await api(`/api/wallets/${w.id}`, { method: 'PATCH', body: JSON.stringify({ label: input.value }) });
          state.renaming = null;
          await load();
        } catch (err) {
          error.textContent = err.message;
          error.hidden = false;
        }
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') cancel();
      });
      return h(
        'li',
        { class: 'renaming' },
        h('span', { class: 'label name' }, kindLogo(w.kind), input),
        h(
          'span',
          { class: 'actions' },
          iconButton('check', 'Save name', save, 'confirm'),
          iconButton('x', 'Cancel', cancel),
        ),
        error,
      );
    }),
  );
  const input = $('wallets').querySelector('input');
  if (input) {
    input.focus();
    input.select();
  }
}

// ── Dialogs ──────────────────────────────────────────────────────────────────

function setError(id, message) {
  const el = $(id);
  el.textContent = message ?? '';
  el.hidden = !message;
}

for (const dialog of document.querySelectorAll('dialog')) {
  for (const button of dialog.querySelectorAll('[data-close]')) button.addEventListener('click', () => dialog.close());
  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

/** Runs a dialog's request with its buttons disabled; an error stays in the dialog. */
async function submitDialog(form, errorId, request) {
  const buttons = [...form.querySelectorAll('button')];
  setError(errorId, null);
  buttons.forEach((b) => (b.disabled = true));
  try {
    await request();
    form.closest('dialog').close();
    return true;
  } catch (err) {
    setError(errorId, err.message);
    return false;
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

const NETWORKS = [
  [
    'evm',
    /^0x[0-9a-fA-F]{40}$/,
    'EVM address. Ethereum, Base, Arbitrum, BNB Chain and the other EVM chains are read at once.',
  ],
  ['ton', /^(?:[A-Za-z0-9_-]{48}|-?\d+:[0-9a-fA-F]{64})$/, 'TON address.'],
  ['solana', /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'Solana address.'],
];

function showDetected() {
  const address = $('add-wallet').address.value.trim();
  const found = NETWORKS.find(([, pattern]) => pattern.test(address));
  $('detected').replaceChildren(
    ...(found
      ? [kindLogo(found[0]), h('span', {}, found[2])]
      : [
          address
            ? 'This does not look like an EVM, Solana or TON address yet.'
            : 'The network is recognised from the address.',
        ]),
  );
}

$('add-wallet').address.addEventListener('input', showDetected);

for (const button of document.querySelectorAll('[data-open-add]')) {
  button.addEventListener('click', () => {
    $('add-wallet').reset();
    setError('add-error', null);
    showDetected();
    $('add-dialog').showModal();
    $('add-wallet').address.focus();
  });
}

$('add-wallet').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const added = await submitDialog(form, 'add-error', () =>
    api('/api/wallets', {
      method: 'POST',
      body: JSON.stringify({ address: form.address.value.trim(), label: form.label.value.trim() }),
    }),
  );
  if (added) await update(); // read the new wallet straight away
});

let removing = null;

function openRemove(wallet) {
  removing = wallet;
  setError('remove-error', null);
  $('remove-text').replaceChildren(
    h('b', {}, wallet.label),
    ` (${wallet.address}) leaves the dashboard together with its recorded history. Nothing changes on chain, and you can add the wallet again later.`,
  );
  $('remove-dialog').showModal();
}

$('remove-wallet').addEventListener('submit', async (event) => {
  event.preventDefault();
  const removed = await submitDialog(event.currentTarget, 'remove-error', () =>
    api(`/api/wallets/${removing.id}`, { method: 'DELETE' }),
  );
  if (removed) await load();
});

// ── Tooltip and banner ───────────────────────────────────────────────────────

function showTip(event, title, text) {
  const tip = $('tip');
  tip.replaceChildren(h('b', {}, title), text);
  tip.hidden = false;
  const { width } = tip.getBoundingClientRect();
  tip.style.left = `${Math.min(event.clientX + 14, window.innerWidth - width - 8)}px`;
  tip.style.top = `${event.clientY + 18}px`;
}

const hideTip = () => ($('tip').hidden = true);

/** A failure of the page itself, as opposed to one account being out of date. */
function showBanner(err) {
  const banner = $('banner');
  banner.replaceChildren(
    icon('triangle-alert'),
    h(
      'span',
      {},
      `${state.data ? 'The dashboard could not be refreshed.' : 'The dashboard could not be loaded.'} ${err.message} `,
    ),
    h('button', { class: 'link', type: 'button', onclick: () => load() }, 'Try again'),
  );
  banner.hidden = false;
  if (!state.data) $('updated').textContent = 'Not loaded';
}

// ── Loading ──────────────────────────────────────────────────────────────────

let pollTimer;

async function load() {
  try {
    const data = await api('/api/portfolio');
    // The server was updated while this tab was open: its code no longer matches the answers. Start over.
    state.build ??= data.build;
    if (data.build !== state.build) {
      location.reload();
      return;
    }
    state.data = data;
    state.logos = new Map(Object.entries(data.logos.available));
    state.chainNames = data.logos.chains;
    $('banner').hidden = true;

    const empty = data.holdings.length === 0;
    $('welcome').hidden = !empty || data.collecting || state.updating;
    $('content').hidden = empty;
    renderSummary();
    renderWallets();
    if (!empty) {
      renderAllocation();
      renderPositions();
      renderSignals();
      renderDefi();
      await renderHistory();
    }
    // A collection started elsewhere (the schedule, another tab) is still running: look again shortly.
    clearTimeout(pollTimer);
    if (data.collecting) pollTimer = setTimeout(load, 4000);
  } catch (err) {
    showBanner(err);
  }
}

async function update() {
  if (state.updating) return;
  state.updating = true;
  if (state.data) renderSummary();
  let failure = null;
  try {
    await api('/api/collect', { method: 'POST', body: '{}' });
  } catch (err) {
    failure = err;
  }
  state.updating = false;
  await load();
  if (failure) showBanner(failure);
  // Logos of newly seen tokens are fetched after the update; pick them up once they are in.
  else setTimeout(load, 15000);
}

$('collect').addEventListener('click', update);
$('sign-out').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST', body: '{}' });
  location.replace('/login');
});
setInterval(load, 5 * 60 * 1000);

load();
