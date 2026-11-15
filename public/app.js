const $ = (id) => document.getElementById(id);

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

const SVG = 'http://www.w3.org/2000/svg';

function icon(name) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG, 'use');
  use.setAttribute('href', `/icons.svg#${name}`);
  svg.append(use);
  return svg;
}

const iconButton = (name, label, onclick, cls = '') =>
  h('button', { class: `icon-button ${cls}`, type: 'button', 'aria-label': label, title: label, onclick }, icon(name));

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

const KIND_TOKEN = { binance: 'BNB', evm: 'ETH', solana: 'SOL', ton: 'TON' };
const CHAIN_TOKEN = { binance: 'BNB', ton: 'TON' };
const kindLogo = (kind) => logo('token', KIND_TOKEN[kind], KINDS[kind]);
const chainLogo = (id) =>
  CHAIN_TOKEN[id] ? logo('token', CHAIN_TOKEN[id], chainName(id)) : logo('chain', id, chainName(id));

const usd = (n) =>
  `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usdRound = (n) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const quantity = (n) => n.toLocaleString('en-US', { maximumSignificantDigits: 6 });
const price = (n) => (n == null ? '—' : `$${n.toLocaleString('en-US', { maximumSignificantDigits: 5 })}`);
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
  view: 'overview',
  progress: null,
};

async function api(path, options) {
  let response;
  try {
    response = await fetch(path, options && { ...options, headers: { 'content-type': 'application/json' } });
  } catch {
    throw new Error('The server did not answer. Check the connection.');
  }
  if (response.status === 401) {
    location.replace('/login');
    return new Promise(() => {});
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

function renderSummary() {
  const { data } = state;
  const [whole, cents] = usd(data.netWorth).split('.');
  $('net-worth').replaceChildren(whole, h('span', { class: 'cents' }, `.${cents}`));
  $('views-worth').textContent = usdRound(data.netWorth);

  const fact = (label, ...value) => h('div', {}, h('dt', {}, label), h('dd', {}, ...value));
  $('facts').replaceChildren(
    fact('24 hours', change(data.changes.d1)),
    fact('7 days', change(data.changes.d7)),
    fact('30 days', change(data.changes.d30)),
    data.fearGreed && fact('Fear & Greed', String(data.fearGreed.value), h('small', {}, data.fearGreed.label)),
  );
  $('sign-out').hidden = !data.loginEnabled;
  renderUpdating();
  renderNotices();
}

const busy = () => state.updating || state.data?.collecting || state.progress !== null;
const labelOf = (id) => state.data?.sources.find((s) => s.id === id)?.label ?? 'an account';

function renderUpdating() {
  const { data, progress } = state;
  const button = $('collect');
  button.disabled = busy();
  button.classList.toggle('spinning', busy());
  button.title = busy() ? 'Updating…' : `Update now. Updates on its own every ${data.collectEveryMinutes} min.`;

  let line;
  if (progress?.phase === 'signals') line = 'Updating signals…';
  else if (progress) {
    const done = progress.accounts.filter((a) => a.state === 'done' || a.state === 'failed').length;
    const current = progress.accounts.find((a) => a.state === 'reading');
    line = current
      ? `${current.note ? `${labelOf(current.id)}: ${current.note}` : `Reading ${labelOf(current.id)}`} · ${done} of ${progress.accounts.length}`
      : `Updating · ${done} of ${progress.accounts.length}`;
  } else if (busy()) line = 'Updating…';
  else line = data.updatedAt ? `Updated ${ago(data.updatedAt)}` : 'Not updated yet';
  $('updated').textContent = line;
  renderSources();
}

const isOld = (s) =>
  s.oldestRead && Date.now() - Date.parse(s.oldestRead) > 2 * state.data.collectEveryMinutes * 60_000;

function renderSources() {
  const live = new Map((state.progress?.accounts ?? []).map((a) => [a.id, a]));
  $('sources').replaceChildren(
    ...state.data.sources.map((s) => {
      const step = live.get(s.id);
      const mark = step
        ? {
            waiting: ['waiting', null, 'Waiting to be read'],
            reading: ['reading', 'refresh-cw', step.note ?? 'Reading now'],
            done: ['done', 'check', 'Read'],
            failed: ['problem', 'triangle-alert', step.note ?? 'Could not be read'],
          }[step.state]
        : s.status === null
          ? ['problem', 'clock', 'Not read yet']
          : s.stale
            ? ['problem', 'triangle-alert', 'Out of date']
            : isOld(s)
              ? ['aged', 'clock', `Some balances are from ${ago(s.oldestRead)}`]
              : null;
      return h(
        'li',
        {
          class: mark?.[0] ?? '',
          title: mark ? mark[2] : `${usd(s.value)}, updated ${ago(s.collectedAt)}`,
        },
        kindLogo(s.kind),
        h('span', { class: 'chip-label' }, s.label),
        (!mark || mark[0] === 'aged' || mark[0] === 'done' || mark[0] === 'waiting') &&
          s.status !== null &&
          h('span', { class: 'num muted' }, usdRound(s.value)),
        mark?.[1] && icon(mark[1]),
        mark && h('span', { class: 'sr-only' }, mark[2]),
      );
    }),
  );
}

const joinNames = (names) =>
  names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

function renderNotices() {
  const groups = new Map();
  const add = (key, source, text) => {
    if (!groups.has(key)) groups.set(key, { text, sources: [] });
    groups.get(key).sources.push(source);
  };
  for (const s of state.data.sources) {
    if (s.stale) add(`error\n${s.error}`, s, s.error ?? '');
    for (const w of s.warnings) if (/allowance|rate limiting|left out/i.test(w)) add(`warn\n${w}`, s, w);
  }
  $('notices').replaceChildren(
    ...[...groups].map(([key, { text, sources }]) => {
      const names = joinNames(sources.map((s) => s.label));
      const error = key.startsWith('error');
      const oldest = sources.reduce(
        (min, s) => (s.collectedAt && (!min || s.collectedAt < min) ? s.collectedAt : min),
        null,
      );
      return h(
        'li',
        { class: error ? '' : 'info' },
        icon(error ? 'triangle-alert' : 'clock'),
        h(
          'span',
          {},
          h('b', {}, names),
          error
            ? oldest
              ? ` could not be updated. Showing balances from ${ago(oldest)}. `
              : ' could not be read and are missing from the totals. '
            : ': ',
          h('span', { class: error ? 'muted' : '' }, text),
        ),
      );
    }),
  );
}

function groups(dimension) {
  const [, , keyOf, logoOf] = DIMENSIONS.find(([id]) => id === dimension);
  const totals = new Map();
  const samples = new Map();
  for (const x of state.data.holdings) {
    if (x.value <= 0) continue;
    const key = keyOf(x);
    totals.set(key, (totals.get(key) ?? 0) + x.value);
    if (!samples.has(key)) samples.set(key, x);
  }
  const sorted = [...totals].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, v]) => s + v, 0);

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
  if (other / total >= 0.0005) shown.push({ name: 'Other', value: other });
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

const reading = (a, name) => a.signal?.components.find((c) => c.name === name)?.value ?? null;

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

  $('positions-lead').textContent = 'Select an asset to see where it is held.';
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

function renderSignals() {
  const scored = state.data.assets.filter((a) => a.signal && Math.abs(a.value) >= DUST_USD);
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

function readNote(items) {
  const oldest = items.reduce((min, x) => (x.readAt && (!min || x.readAt < min) ? x.readAt : min), null);
  if (!oldest || Date.now() - Date.parse(oldest) < 30 * 60_000) return null;
  return h(
    'p',
    { class: 'read-at', title: 'Positions in protocols are read less often to stay within the free allowance' },
    icon('clock'),
    `Read ${ago(oldest)}`,
  );
}

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

function accountStatus(s) {
  if (s.status === null) return ['muted', 'Not read yet'];
  if (s.stale) return ['warn', `Out of date, from ${ago(s.collectedAt)}. ${s.error ?? ''}`];
  if (isOld(s)) return ['muted', `Updated ${ago(s.collectedAt)}; some balances are from ${ago(s.oldestRead)}`];
  return ['muted', `Updated ${ago(s.collectedAt)}`];
}

function renderAccounts() {
  $('wallets').replaceChildren(
    ...state.data.sources.map((w) => {
      const exchange = w.kind === 'binance';
      const [tone, status] = accountStatus(w);
      const details = h(
        'div',
        { class: 'details' },
        h('p', { class: tone }, status),
        ...w.warnings.map((text) => h('p', { class: 'muted' }, text)),
      );

      if (state.renaming !== w.id) {
        return h(
          'li',
          {},
          h('span', { class: 'label name' }, kindLogo(w.kind), h('span', {}, w.label)),
          h('span', { class: 'kind muted' }, exchange ? 'Exchange' : KINDS[w.kind]),
          h('span', { class: 'address num muted' }, exchange ? 'Read-only API key' : w.address),
          h('span', { class: 'num' }, w.status === null ? '—' : usd(w.value)),
          h(
            'span',
            { class: 'actions' },
            !exchange &&
              iconButton('pencil', `Rename ${w.label}`, () => {
                state.renaming = w.id;
                renderAccounts();
              }),
            !exchange && iconButton('trash-2', `Remove ${w.label}`, () => openRemove(w)),
          ),
          details,
        );
      }

      const input = h('input', { value: w.label, maxlength: 40, 'aria-label': 'Wallet name' });
      const error = h('p', { class: 'form-error', role: 'alert', hidden: true });
      const cancel = () => {
        state.renaming = null;
        renderAccounts();
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

  const z = state.data.zerion;
  $('quota').textContent =
    z?.dayLimit != null
      ? `EVM and Solana wallets are read through Zerion. Its ${z.tier ?? 'free'} key allows ${z.dayLimit} requests a day; ${z.dayRemaining ?? '?'} are left${z.dayResetsAt ? `, renewing in ${Math.max(1, Math.ceil((z.dayResetsAt - Date.now()) / 3_600_000))} h` : ''}. To stay within it, token balances are read at most every ${z.balancesEveryMinutes} minutes per wallet and DeFi positions every ${z.defiEveryMinutes >= 120 ? `${z.defiEveryMinutes / 60} hours` : 'hour'}.`
      : '';
}

const VIEWS = ['overview', 'positions', 'signals', 'defi', 'accounts'];
const tabs = () => [...document.querySelectorAll('[role="tab"]')];

function showView(id, focus = false) {
  state.view = VIEWS.includes(id) ? id : 'overview';
  for (const tab of tabs()) {
    const on = tab.dataset.view === state.view;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    if (on && focus) tab.focus();
  }
  for (const view of VIEWS) $(`view-${view}`).hidden = view !== state.view;
  if (state.view === 'overview') chart?.resize();
}

function renderCounts() {
  const { data } = state;
  const set = (name, text, tone = '') => {
    const el = document.querySelector(`[data-count="${name}"]`);
    el.textContent = text;
    el.className = `count ${tone}`;
  };
  set('positions', String(data.assets.filter((a) => Math.abs(a.value) >= DUST_USD).length));
  const hot = data.assets.filter((a) => a.signal?.zone === 'overheated' && Math.abs(a.value) >= DUST_USD).length;
  set('signals', hot ? `${hot} hot` : '', hot ? 'hot' : '');
  set(
    'defi',
    String(new Set(data.holdings.filter((x) => x.protocol && x.kind !== 'binance').map((x) => x.protocol)).size || ''),
  );
  const troubled = data.sources.filter((s) => s.stale || s.status === null).length;
  set('accounts', troubled ? `${troubled} !` : String(data.sources.length), troubled ? 'warn' : '');
}

for (const tab of tabs()) {
  tab.addEventListener('click', () => {
    if (location.hash !== `#${tab.dataset.view}`) location.hash = tab.dataset.view;
    showView(tab.dataset.view);
    if ($('views').classList.contains('stuck')) $('views').scrollIntoView();
  });
  tab.addEventListener('keydown', (e) => {
    const list = tabs();
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = list[(list.indexOf(tab) + step + list.length) % list.length];
    location.hash = next.dataset.view;
    showView(next.dataset.view, true);
  });
}
window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
showView(location.hash.slice(1));

new IntersectionObserver(([entry]) => $('views').classList.toggle('stuck', !entry.isIntersecting), {
  rootMargin: '-60px 0px 0px 0px',
}).observe($('net-worth'));

function setError(id, message) {
  const el = $(id);
  el.textContent = message ?? '';
  el.hidden = !message;
}

for (const dialog of document.querySelectorAll('dialog')) {
  for (const button of dialog.querySelectorAll('[data-close]')) button.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

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
  if (added) await update();
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

let categorising = null;

const CATEGORY_SOURCE = {
  manual: 'You chose this category.',
  auto: 'This category was looked up on CoinGecko.',
};

function openCategory(asset) {
  categorising = asset;
  setError('category-error', null);
  $('category-title').textContent = `Category for ${asset.key}`;
  $('category-text').textContent =
    CATEGORY_SOURCE[asset.source] ??
    (asset.category === 'Other'
      ? 'No category was found for this asset.'
      : 'This category comes from the built-in rules.');
  $('category-choices').replaceChildren(
    ...state.data.categories.map((name) =>
      h(
        'label',
        {},
        h('input', { type: 'radio', name: 'category', value: name, checked: name === asset.category }),
        h('span', { class: 'swatch', style: { background: colorOf('category', name) } }),
        name,
      ),
    ),
  );
  $('category-auto').hidden = asset.source !== 'manual';
  $('category-dialog').showModal();
}

async function saveCategory(category) {
  const saved = await submitDialog($('category-form'), 'category-error', () =>
    api(`/api/assets/${encodeURIComponent(categorising.key)}/category`, {
      method: 'PUT',
      body: JSON.stringify({ category }),
    }),
  );
  if (saved) await load();
}

$('category-form').addEventListener('submit', (event) => {
  event.preventDefault();
  saveCategory(new FormData(event.currentTarget).get('category'));
});
$('category-auto').addEventListener('click', () => saveCategory(null));

function showTip(event, title, text) {
  const tip = $('tip');
  tip.replaceChildren(h('b', {}, title), text);
  tip.hidden = false;
  const { width } = tip.getBoundingClientRect();
  tip.style.left = `${Math.min(event.clientX + 14, window.innerWidth - width - 8)}px`;
  tip.style.top = `${event.clientY + 18}px`;
}

const hideTip = () => ($('tip').hidden = true);

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

let progressTimer;

function watchProgress() {
  if (progressTimer) return;
  const tick = async () => {
    try {
      const { collecting, progress } = await api('/api/progress');
      state.progress = progress;
      if (state.data) renderUpdating();
      if (!collecting && !state.updating) {
        progressTimer = null;
        state.progress = null;
        await load();
        return;
      }
    } catch {}
    progressTimer = setTimeout(tick, 1000);
  };
  progressTimer = setTimeout(tick, 300);
}

async function load() {
  try {
    const data = await api('/api/portfolio');
    state.build ??= data.build;
    if (data.build !== state.build) {
      location.reload();
      return;
    }
    state.data = data;
    state.progress = data.progress ?? state.progress;
    state.logos = new Map(Object.entries(data.logos.available));
    state.chainNames = data.logos.chains;
    $('banner').hidden = true;

    const noAccounts = data.sources.length === 0;
    const noBalances = data.holdings.length === 0;
    $('welcome').hidden = !noAccounts;
    $('content').hidden = noAccounts;
    $('overview-empty').hidden = !noBalances;
    $('overview-content').hidden = noBalances;
    renderSummary();
    renderAccounts();
    renderCounts();
    renderPositions();
    renderSignals();
    renderDefi();
    if (!noBalances) {
      renderAllocation();
      await renderHistory();
    }
    if (data.collecting) watchProgress();
  } catch (err) {
    showBanner(err);
  }
}

async function update() {
  if (state.updating) return;
  state.updating = true;
  if (state.data) renderUpdating();
  watchProgress();
  let failure = null;
  try {
    await api('/api/collect', { method: 'POST', body: '{}' });
  } catch (err) {
    failure = err;
  }
  state.updating = false;
  state.progress = null;
  await load();
  if (failure) showBanner(failure);
  else setTimeout(load, 20000);
}

$('collect').addEventListener('click', update);
$('sign-out').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST', body: '{}' });
  location.replace('/login');
});
setInterval(load, 5 * 60 * 1000);

load();
