const $ = (id) => document.getElementById(id);

import { h, help, icon, iconButton, segmented as segmentedControl, select, skeleton } from '/ui.js';

const SOURCES = {
  rsi: {
    label: 'StockCharts ChartSchool: RSI',
    href: 'https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi',
  },
  ma: {
    label: 'StockCharts ChartSchool: moving averages',
    href: 'https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/moving-averages-simple-and-exponential',
  },
  funding: {
    label: 'Binance: funding rates',
    href: 'https://www.binance.com/en/support/faq/introduction-to-binance-futures-funding-rates-360033525031',
  },
  openInterest: { label: 'Wikipedia: open interest', href: 'https://en.wikipedia.org/wiki/Open_interest' },
  fearGreed: {
    label: 'alternative.me: Fear & Greed Index',
    href: 'https://alternative.me/crypto/fear-and-greed-index/',
  },
  binanceKeys: {
    label: 'Binance: how to create API keys',
    href: 'https://www.binance.com/en/support/faq/how-to-create-api-keys-on-binance-360002502072',
  },
};

const HELP = {
  rsi: {
    title: 'RSI',
    text: 'The Relative Strength Index compares the size of recent gains with recent losses over 14 periods, on a scale from 0 to 100. Above 70 is usually read as overbought, below 30 as oversold. Shown here on daily candles.',
    source: SOURCES.rsi,
  },
  rsiWeekly: {
    title: 'Weekly RSI',
    text: 'The same Relative Strength Index on weekly candles. It moves slower and shows the longer trend.',
    source: SOURCES.rsi,
  },
  funding: {
    title: 'Funding',
    text: 'Perpetual futures have no expiry, so longs and shorts pay each other a funding rate every few hours. A positive rate means longs pay shorts and leverage leans long. Shown as the three-day average per 8 hours. The usual resting rate on Binance is 0.01%.',
    source: SOURCES.funding,
  },
  ma200: {
    title: '200-day average',
    text: 'How far the price is above or below its average close over the last 200 days. A price far above it has run ahead of its long trend.',
    source: SOURCES.ma,
  },
  openInterest: {
    title: 'Open interest',
    text: 'The number of futures contracts still open. When it grows while the price rises, new leverage is coming in.',
    source: SOURCES.openInterest,
  },
  heat: {
    title: 'Heat',
    text: "Stashboard's own score from 0 (cold) to 100 (overheated). It blends RSI, funding, the price against its 200-day average and open interest. It describes market conditions and is not advice.",
    source: { label: 'How heat is scored', href: '#signals' },
  },
  fearGreed: {
    title: 'Fear & Greed',
    text: "Rates the crypto market's mood from 0 (extreme fear) to 100 (extreme greed), from volatility, momentum and volume, social media, Bitcoin dominance and search trends. Updated once a day.",
    source: SOURCES.fearGreed,
  },
};

const FEAR_GREED_TONE = [
  [25, 'cold'],
  [45, 'cool'],
  [56, 'neutral'],
  [76, 'warm'],
  [101, 'hot'],
];
const fearGreedTone = (value) => FEAR_GREED_TONE.find(([limit]) => value < limit)[1];

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

const MASK = '•••••';
const money = (n) => (state.hideAmounts ? `$${MASK}` : usd(n));
const moneyRound = (n) => (state.hideAmounts ? `$${MASK}` : usdRound(n));
const units = (n) => (state.hideAmounts ? MASK.slice(0, 3) : quantity(n));
const usd = (n) =>
  `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usdRound = (n) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const quantity = (n) => n.toLocaleString('en-US', { maximumSignificantDigits: 6 });
const price = (n) => (n == null ? '—' : `$${n.toLocaleString('en-US', { maximumSignificantDigits: 5 })}`);
const fixed = (n, digits) =>
  (Number(n.toFixed(digits)) === 0 ? (0).toFixed(digits) : n.toFixed(digits)).replace('-', '−');
const signedPercent = (v) => {
  const rounded = Math.round(v);
  return rounded === 0 ? '0%' : `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}%`;
};
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
  ['asset', 'Asset', (x) => x.asset, (x) => ({ kind: 'token', key: x.asset })],
  [
    'chain',
    'Chain',
    (x) => chainName(x.chain),
    (x) => (CHAIN_TOKEN[x.chain] ? { kind: 'token', key: CHAIN_TOKEN[x.chain] } : { kind: 'chain', key: x.chain }),
  ],
  ['venue', 'Account', (x) => x.account, (x) => ({ kind: 'token', key: KIND_TOKEN[x.kind] })],
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
  hideAmounts: false,
  signalZone: null,
  shareDimension: 'category',
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
  if (!response.ok) {
    throw Object.assign(new Error(body.error ?? `Request failed (${response.status})`), { status: response.status });
  }
  return body;
}

const hasBalances = () => state.data.holdings.length > 0;
const firstRead = () => !hasBalances() && busy();

function inTime(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 90) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 36 ? `${hours} h` : `${Math.round(hours / 24)} days`;
}

function pendingChange(days) {
  const since = state.data.historySince;
  if (!since) return h('span', { class: 'pending' }, 'after the first update');
  const due = Date.parse(since) + days * 86_400_000 - Date.now();
  return h('span', { class: 'pending' }, due > 0 ? `in ${inTime(due)}` : 'soon');
}

const changeOrPending = (value, days) => (value == null ? pendingChange(days) : change(value));

function renderSummary() {
  const { data } = state;
  const [whole, cents] = usd(data.netWorth).split('.');
  $('net-worth').replaceChildren(
    ...(firstRead()
      ? [skeleton('sk-worth')]
      : state.hideAmounts
        ? ['$', h('span', { class: 'cents' }, MASK)]
        : [whole, h('span', { class: 'cents' }, `.${cents}`)]),
  );
  const privacy = $('privacy');
  const label = state.hideAmounts ? 'Show amounts' : 'Hide amounts';
  privacy.setAttribute('aria-pressed', String(state.hideAmounts));
  privacy.setAttribute('aria-label', label);
  privacy.title = label;
  privacy.querySelector('use').setAttribute('href', `/icons.svg#${state.hideAmounts ? 'eye-off' : 'eye'}`);
  $('views-worth').textContent = moneyRound(data.netWorth);

  const fact = (label, ...value) => h('div', {}, h('dt', {}, label), h('dd', {}, ...value));
  $('facts').replaceChildren(
    fact('24 hours', changeOrPending(data.changes.d1, 1)),
    fact('7 days', changeOrPending(data.changes.d7, 7)),
    fact('30 days', changeOrPending(data.changes.d30, 30)),
    data.fearGreed &&
      h(
        'div',
        { class: `fear-greed ${fearGreedTone(data.fearGreed.value)}` },
        h('dt', {}, 'Fear & Greed', help(HELP.fearGreed)),
        h('dd', {}, h('b', {}, String(data.fearGreed.value)), h('small', {}, data.fearGreed.label)),
      ),
  );
  renderUpdating();
  renderNotices();
}

const busy = () => state.updating || state.data?.collecting || state.progress !== null;
let gateTimer;

const inMinutes = (at) => {
  const minutes = Math.max(1, Math.ceil((at - Date.now()) / 60_000));
  return minutes < 90 ? `${minutes} min` : `${Math.ceil(minutes / 60)} h`;
};
const labelOf = (id) => state.data?.sources.find((s) => s.id === id)?.label ?? 'an account';

function renderUpdating() {
  const { data, progress } = state;
  const gate = data.update ?? { allowed: true };
  const button = $('collect');
  button.disabled = busy() || !gate.allowed;
  button.classList.toggle('spinning', busy());
  button.title = busy()
    ? 'Updating…'
    : gate.allowed
      ? `Update now. Updates on its own every ${data.collectEveryMinutes} min.`
      : `${gate.reason}${gate.availableAt ? `. Available again in ${inMinutes(gate.availableAt)}` : ''}.`;
  clearTimeout(gateTimer);
  if (!busy() && !gate.allowed && gate.availableAt && gate.availableAt - Date.now() < 15 * 60_000) {
    gateTimer = setTimeout(load, Math.max(1000, gate.availableAt - Date.now() + 500));
  }

  let line;
  if (progress?.phase === 'signals') line = 'Updating signals…';
  else if (progress) {
    const done = progress.accounts.filter((a) => a.state === 'done' || a.state === 'failed').length;
    const current = progress.accounts.find((a) => a.state === 'reading');
    line = current
      ? `${current.note ? `${labelOf(current.id)}: ${current.note}` : `Reading ${labelOf(current.id)}`} · ${done} of ${progress.accounts.length}`
      : `Updating · ${done} of ${progress.accounts.length}`;
  } else if (busy()) line = 'Updating…';
  else {
    line = data.updatedAt ? `Updated ${ago(data.updatedAt)}` : 'Not updated yet';
    if (!gate.allowed && gate.availableAt && gate.availableAt - Date.now() > 10 * 60_000) line += ` · ${gate.reason}`;
  }
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
          title: mark ? mark[2] : `${money(s.value)}, updated ${ago(s.collectedAt)}`,
        },
        kindLogo(s.kind),
        h('span', { class: 'chip-label' }, s.label),
        (!mark || mark[0] === 'aged' || mark[0] === 'done' || mark[0] === 'waiting') &&
          s.status !== null &&
          h('span', { class: 'num muted' }, moneyRound(s.value)),
        mark?.[1] && icon(mark[1]),
        mark && h('span', { class: 'sr-only' }, mark[2]),
      );
    }),
    h(
      'li',
      { class: 'add-chip' },
      h('button', { type: 'button', onclick: () => openAdd() }, icon('plus'), 'Add wallet or exchange'),
    ),
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
    total,
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
        h('span', { class: 'swatch', style: { background: r.color } }),
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

const reading = (a, name) => a.signal?.components.find((c) => c.name === name)?.value ?? null;

const COLUMNS = [
  ['key', 'Asset', '', (a) => a.key],
  ['quantity', 'Quantity', 'optional', (a) => a.quantity],
  ['price', 'Price', 'optional', (a) => a.price],
  ['value', 'Value', '', (a) => a.value],
  ['share', 'Share', '', (a) => a.share],
  ['change1d', '24 h', '', (a) => a.change1d],
  ['change7d', '7 d', 'optional', (a) => a.change7d],
  ['rsi', 'RSI', 'optional', (a) => reading(a, 'rsiDaily'), HELP.rsi],
  ['funding', 'Funding', 'optional', (a) => reading(a, 'funding'), HELP.funding],
  ['heat', 'Heat', '', (a) => a.signal?.score ?? null, HELP.heat],
];

const ZONES = { cold: 'Cold', neutral: 'Neutral', warm: 'Warm', overheated: 'Overheated' };
const READINGS = {
  rsiDaily: ['Daily RSI', (v) => v.toFixed(0)],
  rsiWeekly: ['Weekly RSI', (v) => v.toFixed(0)],
  funding: ['Funding', (v) => `${fixed(v, 4)}% per 8 h`],
  ma200: ['Price against its 200-day average', signedPercent],
  oiGrowth: ['Open interest over 7 days', signedPercent],
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
        h('td', { class: 'num optional' }, units(a.quantity)),
        h('td', { class: 'num optional' }, price(a.price)),
        h('td', { class: 'num' }, money(a.value)),
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

function renderSignals() {
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
          h('span', { class: 'address num muted' }, w.address),
          h('span', { class: 'num' }, w.status === null ? '—' : money(w.value)),
          h(
            'span',
            { class: 'actions' },
            iconButton('pencil', `Rename ${w.label}`, () => {
              state.renaming = w.id;
              renderAccounts();
            }),
            iconButton('trash-2', `Remove ${w.label}`, () => openRemove(w)),
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
          await api(`/api/accounts/${w.id}`, { method: 'PATCH', body: JSON.stringify({ label: input.value }) });
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

const VIEWS = ['overview', 'positions', 'signals', 'defi', 'accounts'];
const tabs = () => [...document.querySelectorAll('[role="tab"]')];

function showView(id, focus = false) {
  for (const open of document.querySelectorAll('.popover:popover-open')) open.hidePopover();
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
  set('positions', String(data.assets.filter((a) => Math.abs(a.value) >= DUST_USD).length || ''));
  const hot = data.assets.filter((a) => a.signal?.zone === 'overheated' && Math.abs(a.value) >= DUST_USD).length;
  set('signals', hot ? `${hot} hot` : '', hot ? 'hot' : '');
  set(
    'defi',
    String(new Set(data.holdings.filter((x) => x.protocol && x.kind !== 'binance').map((x) => x.protocol)).size || ''),
  );
  const troubled = data.sources.filter((s) => s.stale || (s.status === null && !busy())).length;
  set('accounts', troubled ? `${troubled} !` : String(data.sources.length), troubled ? 'warn' : '');
}

for (const tab of tabs()) {
  tab.addEventListener('click', () => {
    if (location.hash !== `#${tab.dataset.view}`) history.pushState(null, '', `#${tab.dataset.view}`);
    showView(tab.dataset.view);
    if ($('views').classList.contains('stuck')) $('views').scrollIntoView();
  });
  tab.addEventListener('keydown', (e) => {
    const list = tabs();
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = list[(list.indexOf(tab) + step + list.length) % list.length];
    history.pushState(null, '', `#${next.dataset.view}`);
    showView(next.dataset.view, true);
  });
}
window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
window.addEventListener('popstate', () => showView(location.hash.slice(1)));
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

const addForm = $('add-form');
let addKind = 'wallet';
const exchangeChoice = select({
  label: 'Exchange',
  options: [{ value: 'binance', label: 'Binance' }],
  value: 'binance',
});
$('exchange-select').append(exchangeChoice);
$('exchange-hint').replaceChildren(
  'Create a key with only ',
  h('b', {}, 'Enable Reading'),
  " ticked and restrict it to this server's IP address. The key is checked before it is saved, and the secret is stored encrypted on this server. ",
  h(
    'a',
    { href: SOURCES.binanceKeys.href, target: '_blank', rel: 'noopener noreferrer' },
    'How to create an API key',
    icon('external-link'),
  ),
);

function setAddKind(kind) {
  addKind = kind;
  $('add-kind').replaceChildren(
    segmentedControl({
      label: 'What to add',
      options: [
        ['wallet', 'Wallet'],
        ['exchange', 'Exchange'],
      ],
      value: kind,
      onChange: setAddKind,
    }),
  );
  $('wallet-fields').hidden = kind !== 'wallet';
  $('exchange-fields').hidden = kind !== 'exchange';
  $('add-submit').textContent = kind === 'wallet' ? 'Add wallet' : 'Add exchange';
  addForm.label.placeholder = kind === 'wallet' ? 'Optional, for example Ledger' : 'Optional, for example Binance main';
  setError('add-error', null);
  (kind === 'wallet' ? addForm.address : addForm.apiKey).focus();
}

function showDetected() {
  const address = addForm.address.value.trim();
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

addForm.address.addEventListener('input', showDetected);

function openAdd(kind = 'wallet') {
  addForm.reset();
  showDetected();
  $('add-dialog').showModal();
  setAddKind(kind);
}

for (const trigger of document.querySelectorAll('[data-open-add]')) {
  trigger.addEventListener('click', () => openAdd(trigger.dataset.openAdd || 'wallet'));
}

addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const label = addForm.label.value.trim();
  let warning = null;
  const added = await submitDialog(addForm, 'add-error', async () => {
    if (addKind === 'wallet') {
      if (!addForm.address.value.trim()) throw new Error('Enter a wallet address');
      await api('/api/wallets', {
        method: 'POST',
        body: JSON.stringify({ address: addForm.address.value.trim(), label }),
      });
      return;
    }
    if (!addForm.apiKey.value.trim() || !addForm.apiSecret.value.trim()) {
      throw new Error('Paste both the API key and the secret key');
    }
    const result = await api('/api/exchanges', {
      method: 'POST',
      body: JSON.stringify({
        exchange: exchangeChoice.value,
        apiKey: addForm.apiKey.value.trim(),
        apiSecret: addForm.apiSecret.value.trim(),
        label,
      }),
    });
    warning = result.warning;
  });
  addForm.apiSecret.value = '';
  if (!added) return;
  await load();
  if (warning) showInfo(warning);
});

let removing = null;

function openRemove(account) {
  removing = account;
  const exchange = account.kind === 'binance';
  setError('remove-error', null);
  $('remove-title').textContent = exchange ? 'Remove exchange' : 'Remove wallet';
  $('remove-submit').textContent = exchange ? 'Remove exchange' : 'Remove wallet';
  $('remove-text').replaceChildren(
    h('b', {}, account.label),
    exchange
      ? ` (${account.address}) leaves the dashboard together with its recorded history and its stored API key. Nothing changes on the exchange. You can also delete the key there.`
      : ` (${account.address}) leaves the dashboard together with its recorded history. Nothing changes on chain, and you can add the wallet again later.`,
  );
  $('remove-dialog').showModal();
}

$('remove-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const removed = await submitDialog(event.currentTarget, 'remove-error', () =>
    api(`/api/accounts/${removing.id}`, { method: 'DELETE' }),
  );
  if (removed) await load();
});

$('open-reset').addEventListener('click', () => {
  setError('reset-error', null);
  $('reset-dialog').showModal();
});

$('reset-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  let result = null;
  const done = await submitDialog(event.currentTarget, 'reset-error', async () => {
    result = await api('/api/history/reset', { method: 'POST', body: '{}' });
  });
  if (!done) return;
  await load();
  showInfo(
    `History starts over from now. ${result.removed} earlier ${result.removed === 1 ? 'update was' : 'updates were'} removed, and a copy was saved as ${result.backup}.`,
  );
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

async function setHideAmounts(hide) {
  state.hideAmounts = hide;
  $('hide-amounts').checked = hide;
  await renderAll();
  try {
    await api('/api/preferences', { method: 'PUT', body: JSON.stringify({ hideAmounts: hide }) });
  } catch (err) {
    showBanner(err);
  }
}

$('privacy').addEventListener('click', () => setHideAmounts(!state.hideAmounts));
$('hide-amounts').addEventListener('change', (event) => setHideAmounts(event.target.checked));

const shareUrl = (token) => `${location.origin}/s/${token}`;

function timeLeft(iso) {
  const hours = Math.max(1, Math.round((Date.parse(iso) - Date.now()) / 3_600_000));
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`;
}

async function renderShareLinks() {
  const list = $('share-links');
  let links;
  try {
    links = await api('/api/shares');
  } catch (err) {
    list.replaceChildren(h('li', { class: 'muted' }, err.message));
    return;
  }
  if (links.length === 0) {
    list.replaceChildren(h('li', { class: 'muted' }, 'No shared links. Create one with Share in Allocation.'));
    return;
  }
  list.replaceChildren(
    ...links.map((link) =>
      h(
        'li',
        {},
        h(
          'div',
          {},
          h('b', {}, link.title),
          h(
            'small',
            {},
            `${link.withAmounts ? 'With amounts' : 'Shares only'}, works for ${timeLeft(link.expiresAt)} more`,
          ),
        ),
        h(
          'span',
          { class: 'actions' },
          iconButton('copy', `Copy the link to ${link.title}`, async (event) => {
            const button = event.currentTarget;
            try {
              await navigator.clipboard.writeText(shareUrl(link.token));
              button.title = 'Copied';
            } catch {
              window.open(shareUrl(link.token), '_blank', 'noopener');
            }
          }),
          h(
            'a',
            {
              class: 'icon-button',
              href: shareUrl(link.token),
              target: '_blank',
              rel: 'noopener',
              'aria-label': `Open ${link.title}`,
              title: 'Open',
            },
            icon('link'),
          ),
          iconButton('trash-2', `Turn off the link to ${link.title}`, async () => {
            try {
              await api(`/api/shares/${link.token}`, { method: 'DELETE' });
            } catch (err) {
              showBanner(err);
            }
            renderShareLinks();
          }),
        ),
      ),
    ),
  );
}

function renderAccountPanel() {
  const { data } = state;
  const z = data.zerion;
  const gate = data.update ?? { allowed: true };
  $('hide-amounts').checked = state.hideAmounts;
  const fact = (term, ...description) => h('div', {}, h('dt', {}, term), h('dd', {}, ...description));
  const every = (minutes) => (minutes >= 120 ? `${minutes / 60} h` : `${minutes} min`);
  $('update-facts').replaceChildren(
    ...[
      fact('On its own', `Every ${every(data.collectEveryMinutes)}`),
      fact('Last update', data.updatedAt ? ago(data.updatedAt) : 'Not yet'),
      fact(
        'Update now',
        gate.allowed
          ? 'Available'
          : `${gate.reason}${gate.availableAt ? `. Available again in ${inMinutes(gate.availableAt)}` : ''}`,
      ),
      z?.dayLimit != null &&
        fact(
          'Zerion',
          `${z.dayRemaining ?? '?'} of ${z.dayLimit} requests left today${z.dayResetsAt ? `, renews in ${inMinutes(z.dayResetsAt)}` : ''}. Balances are read every ${every(z.balancesEveryMinutes)} at most, DeFi positions every ${every(z.defiEveryMinutes)}.`,
        ),
    ].filter(Boolean),
  );
  $('session-text').textContent = data.loginEnabled
    ? 'Signed in on this device. A session lasts 30 days.'
    : 'Sign-in is off: this dashboard is open on this machine only.';
  $('sign-out').hidden = !data.loginEnabled;
}

$('open-account').addEventListener('click', () => {
  renderAccountPanel();
  renderShareLinks();
  $('account').showModal();
});

const SHARE_WIDTH = 1200;
const SHARE_HEIGHT = 675;
const SHARE_SCALE = 2;
let shareTicket = 0;
let shareBlob = null;

const shareTitle = (dimension) => `Allocation by ${DIMENSIONS.find(([id]) => id === dimension)[1].toLowerCase()}`;
const shareFileName = () => `stashboard-${state.shareDimension}-${new Date().toISOString().slice(0, 10)}.png`;
const longDate = (date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function logoSource(spec) {
  const version = spec && state.logos.get(`${spec.kind}/${spec.key}`);
  return version ? `/logo/${spec.kind}/${encodeURIComponent(spec.key)}?v=${version}` : null;
}

function fitText(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

async function drawShareCard({ title, rows, withAmounts }) {
  const ticket = ++shareTicket;
  const css = getComputedStyle(document.documentElement);
  const token = (name) => css.getPropertyValue(name).trim();
  const display = '"Bricolage Grotesque", system-ui, sans-serif';
  const body = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  await Promise.all([document.fonts.load(`600 52px ${display}`), document.fonts.load(`650 28px ${display}`)]).catch(
    () => {},
  );
  const [mark, ...logos] = await Promise.all([
    loadImage('/logo.svg'),
    ...rows.map((r) => loadImage(logoSource(r.logo))),
  ]);
  if (ticket !== shareTicket) return;

  const canvas = $('share-canvas');
  canvas.width = SHARE_WIDTH * SHARE_SCALE;
  canvas.height = SHARE_HEIGHT * SHARE_SCALE;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(SHARE_SCALE, 0, 0, SHARE_SCALE, 0, 0);
  const pad = 64;
  const inner = SHARE_WIDTH - 2 * pad;

  ctx.fillStyle = token('--ink');
  ctx.fillRect(0, 0, SHARE_WIDTH, SHARE_HEIGHT);

  if (mark) ctx.drawImage(mark, pad, 50, 36, 36);
  ctx.font = `650 28px ${display}`;
  ctx.fillStyle = token('--amber');
  ctx.fillText('stash', pad + 48, 78);
  ctx.fillStyle = token('--slate');
  ctx.fillText('board', pad + 49 + ctx.measureText('stash').width, 78);
  ctx.font = `400 22px ${body}`;
  ctx.textAlign = 'right';
  ctx.fillText(longDate(new Date()), SHARE_WIDTH - pad, 78);
  ctx.textAlign = 'left';

  ctx.font = `600 52px ${display}`;
  ctx.fillStyle = token('--bone');
  ctx.fillText(title, pad, 168);
  let top = 210;
  if (withAmounts) {
    ctx.font = `400 24px ${body}`;
    ctx.fillStyle = token('--slate');
    ctx.fillText(`Total held ${usd(rows[0]?.total ?? 0)}`, pad, 210);
    top = 236;
  }

  const height = 64;
  const gap = 4;
  const usable = inner - gap * (rows.length - 1);
  let before = 0;
  rows.forEach((r, i) => {
    const x = pad + before * usable + i * gap;
    const width = i === rows.length - 1 ? pad + inner - x : Math.max(3, r.share * usable);
    before += r.share;
    const left = i === 0 ? height / 2 : 6;
    const right = i === rows.length - 1 ? height / 2 : 6;
    ctx.fillStyle = r.color;
    ctx.beginPath();
    ctx.roundRect(x, top, width, height, [left, right, right, left]);
    ctx.fill();
  });

  const columnGap = 64;
  const columnWidth = (inner - columnGap) / 2;
  const perColumn = Math.max(1, Math.ceil(rows.length / 2));
  const legendTop = top + height + 64;
  rows.forEach((r, i) => {
    const column = i < perColumn ? 0 : 1;
    const x = pad + column * (columnWidth + columnGap);
    const y = legendTop + (i - column * perColumn) * 54;
    const end = x + columnWidth;

    ctx.fillStyle = r.color;
    ctx.beginPath();
    ctx.roundRect(x, y - 17, 16, 16, 4);
    ctx.fill();

    let nameX = x + 32;
    if (r.logo) {
      const img = logos[i];
      ctx.save();
      ctx.beginPath();
      ctx.arc(nameX + 15, y - 9, 15, 0, Math.PI * 2);
      ctx.clip();
      if (img) ctx.drawImage(img, nameX, y - 24, 30, 30);
      else {
        ctx.fillStyle = token('--raised');
        ctx.fillRect(nameX, y - 24, 30, 30);
        ctx.fillStyle = token('--slate');
        ctx.font = `600 12px ${body}`;
        ctx.textAlign = 'center';
        ctx.fillText(
          r.name
            .replace(/[^\p{L}\p{N}]/gu, '')
            .slice(0, 2)
            .toUpperCase(),
          nameX + 15,
          y - 4,
        );
        ctx.textAlign = 'left';
      }
      ctx.restore();
      nameX += 42;
    }

    ctx.textAlign = 'right';
    ctx.font = `600 26px ${display}`;
    ctx.fillStyle = token('--bone');
    const share = percent(r.share);
    ctx.fillText(share, end, y);
    let nameEnd = end - ctx.measureText(share).width - 20;
    if (withAmounts) {
      ctx.font = `400 22px ${body}`;
      ctx.fillStyle = token('--slate');
      const value = usd(r.value);
      ctx.fillText(value, nameEnd, y);
      nameEnd -= ctx.measureText(value).width + 20;
    }
    ctx.textAlign = 'left';
    ctx.font = `500 26px ${body}`;
    ctx.fillStyle = token('--bone');
    ctx.fillText(fitText(ctx, r.name, nameEnd - nameX), nameX, y);
  });

  canvas.setAttribute('aria-label', `${title}: ${rows.map((r) => `${r.name} ${percent(r.share)}`).join(', ')}`);
  shareBlob = new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image could not be made'))), 'image/png'),
  );
}

const shareDays = select({
  label: 'Link lasts',
  options: [
    { value: '1', label: '1 day' },
    { value: '7', label: '7 days' },
    { value: '30', label: '30 days' },
  ],
  value: '7',
});
$('share-days').replaceWith(shareDays);

function shareStatus(...content) {
  $('share-status').replaceChildren(...content);
}

function renderShare() {
  segmented('share-dimension', DIMENSIONS, state.shareDimension, (id) => {
    state.shareDimension = id;
    renderShare();
  });
  shareStatus();
  setError('share-error', null);
  return drawShareCard({
    title: shareTitle(state.shareDimension),
    rows: groups(state.shareDimension),
    withAmounts: $('share-amounts').checked,
  });
}

function canShareFiles() {
  try {
    return Boolean(navigator.canShare?.({ files: [new File([''], 'x.png', { type: 'image/png' })] }));
  } catch {
    return false;
  }
}

$('open-share').addEventListener('click', () => {
  state.shareDimension = state.dimension;
  $('share-amounts').checked = !state.hideAmounts;
  $('share-native').hidden = !canShareFiles();
  $('share-dialog').showModal();
  renderShare();
});

$('share-amounts').addEventListener('change', renderShare);

$('share-copy').addEventListener('click', async () => {
  setError('share-error', null);
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': shareBlob })]);
    shareStatus('Image copied. Paste it into a message.');
  } catch {
    setError('share-error', 'This browser cannot copy images. Download the image instead.');
  }
});

$('share-download').addEventListener('click', async () => {
  setError('share-error', null);
  try {
    const url = URL.createObjectURL(await shareBlob);
    const link = h('a', { href: url, download: shareFileName() });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    shareStatus('Image downloaded.');
  } catch (err) {
    setError('share-error', err.message);
  }
});

$('share-native').addEventListener('click', async () => {
  setError('share-error', null);
  try {
    const file = new File([await shareBlob], shareFileName(), { type: 'image/png' });
    await navigator.share({ files: [file], title: shareTitle(state.shareDimension) });
  } catch (err) {
    if (err.name !== 'AbortError') setError('share-error', err.message);
  }
});

$('share-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  setError('share-error', null);
  const withAmounts = $('share-amounts').checked;
  const rows = groups(state.shareDimension);
  const button = event.submitter;
  button.disabled = true;
  try {
    const { token } = await api('/api/shares', {
      method: 'POST',
      body: JSON.stringify({
        title: shareTitle(state.shareDimension),
        days: Number(shareDays.value),
        showAmounts: withAmounts,
        total: withAmounts ? (rows[0]?.total ?? null) : null,
        rows: rows.map((r) => ({
          name: r.name,
          share: r.share,
          value: withAmounts ? r.value : null,
          color: r.color,
          logo: r.logo && logoSource(r.logo) ? r.logo : null,
        })),
      }),
    });
    const url = shareUrl(token);
    let copied = true;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      copied = false;
    }
    shareStatus(
      copied ? 'Link copied: ' : 'Link: ',
      h('a', { href: url, target: '_blank', rel: 'noopener' }, url),
      `. It works for ${shareDays.selectedLabel} and can be turned off in Settings.`,
    );
  } catch (err) {
    setError('share-error', err.message);
  } finally {
    button.disabled = false;
  }
});

function showTip(event, title, text) {
  const tip = $('tip');
  tip.replaceChildren(h('b', {}, title), text);
  tip.hidden = false;
  const { width } = tip.getBoundingClientRect();
  tip.style.left = `${Math.min(event.clientX + 14, window.innerWidth - width - 8)}px`;
  tip.style.top = `${event.clientY + 18}px`;
}

const hideTip = () => ($('tip').hidden = true);

function showInfo(text) {
  const banner = $('banner');
  banner.className = 'banner info';
  banner.replaceChildren(
    icon('circle-help'),
    h('span', {}, text),
    h('button', { class: 'link', type: 'button', onclick: () => (banner.hidden = true) }, 'Dismiss'),
  );
  banner.hidden = false;
}

function showBanner(err) {
  $('banner').className = 'banner';
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
      const { collecting, progress, update: gate } = await api('/api/progress');
      state.progress = progress;
      if (state.data) {
        state.data.update = gate;
        setPhase(false);
        renderUpdating();
      }
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

function setPhase(redraw = true) {
  const { data } = state;
  const phase = data.sources.length === 0 ? 'empty' : firstRead() ? 'reading' : 'ready';
  const changed = document.body.dataset.state !== phase;
  if (changed) document.body.dataset.state = phase;
  if (!changed && !redraw) return;
  $('facts').removeAttribute('aria-busy');
  $('overview-empty').hidden = hasBalances();
  $('overview-content').hidden = !hasBalances();
  if (hasBalances()) return;
  const failed = data.sources.filter((s) => s.status === 'error').length;
  $('overview-empty').replaceChildren(
    ...(firstRead()
      ? [
          skeleton('sk-strip'),
          h(
            'p',
            { class: 'reading-note' },
            h('b', {}, 'Reading your accounts.'),
            ' Balances appear here as soon as the first update finishes, usually within a minute.',
          ),
        ]
      : [
          h(
            'p',
            { class: 'empty' },
            h('b', {}, 'No balances found yet.'),
            failed
              ? ` ${failed === 1 ? 'One account' : `${failed} accounts`} could not be read. The notice above says why.`
              : ' The accounts added so far hold nothing Stashboard can price.',
            ' Update again, or add another wallet or exchange.',
          ),
        ]),
  );
}

async function renderAll() {
  setPhase();
  renderSummary();
  renderAccounts();
  renderCounts();
  renderPositions();
  renderSignals();
  renderDefi();
  if (state.data.holdings.length > 0) {
    renderAllocation();
    await renderHistory();
  }
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
    state.hideAmounts = data.preferences.hideAmounts;
    state.progress = data.progress ?? state.progress;
    state.logos = new Map(Object.entries(data.logos.available));
    state.chainNames = data.logos.chains;
    $('banner').hidden = true;

    await renderAll();
    if ($('account').open) renderAccountPanel();
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
    if (err.status !== 429) failure = err;
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
