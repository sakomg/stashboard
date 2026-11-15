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

// ── Formatting ───────────────────────────────────────────────────────────────

const usd = (n) =>
  `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usdRound = (n) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const quantity = (n) => n.toLocaleString('en-US', { maximumSignificantDigits: 6 });
const price = (n) => (n == null ? '—' : `$${n.toLocaleString('en-US', { maximumSignificantDigits: 5 })}`);
const percent = (n) => `${(n * 100).toFixed(1)}%`;

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
const CHAINS = { 'binance-smart-chain': 'BNB Chain', binance: 'Binance', ton: 'TON', 'zksync-era': 'zkSync Era' };
const chainName = (id) => CHAINS[id] ?? id.replace(/(^|-)(\w)/g, (_, dash, c) => (dash ? ' ' : '') + c.toUpperCase());

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

const DIMENSIONS = [
  ['category', 'Category', (x) => x.category],
  ['asset', 'Asset', (x) => x.asset],
  ['chain', 'Chain', (x) => chainName(x.chain)],
  ['venue', 'Account', (x) => x.account],
  ['place', 'Kind', (x) => (x.kind === 'binance' ? 'Exchange' : x.protocol ? 'DeFi' : 'Wallet')],
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
  dimension: 'category',
  period: '30',
  sort: { key: 'value', descending: true },
  expanded: new Set(),
  showDust: false,
  renaming: null,
  removing: null,
};

async function api(path, options) {
  const response = await fetch(path, options && { ...options, headers: { 'content-type': 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

// ── Header ───────────────────────────────────────────────────────────────────

function renderHeader() {
  const { data } = state;
  $('sources').replaceChildren(
    ...data.sources.map((s) => {
      const never = s.status === null;
      const note = never ? 'not collected yet' : s.stale ? 'out of date' : null;
      return h(
        'li',
        { title: s.stale ? s.error : s.collectedAt ? `Updated ${ago(s.collectedAt)}` : null },
        h('span', { class: `dot ${never ? 'never' : s.stale ? 'stale' : ''}` }),
        s.label,
        note && h('span', { class: 'state' }, note),
      );
    }),
  );

  const [whole, cents] = usd(data.netWorth).split('.');
  $('net-worth').replaceChildren(whole, h('span', { class: 'cents' }, `.${cents}`));
  $('updated').textContent = data.updatedAt
    ? `Updated ${ago(data.updatedAt)}. Refreshes every ${data.collectEveryMinutes} min.`
    : 'Nothing collected yet. Add a wallet below, then choose Update now.';

  const fact = (label, ...value) => h('div', {}, h('dt', {}, label), h('dd', {}, ...value));
  $('facts').replaceChildren(
    fact('24 hours', change(data.changes.d1)),
    fact('7 days', change(data.changes.d7)),
    fact('30 days', change(data.changes.d30)),
    data.fearGreed && fact('Fear & Greed', String(data.fearGreed.value), h('small', {}, data.fearGreed.label)),
  );

  const button = $('collect');
  button.disabled = data.collecting;
  button.textContent = data.collecting ? 'Updating…' : 'Update now';
}

// ── Allocation ───────────────────────────────────────────────────────────────

function groups(dimension) {
  const [, , keyOf] = DIMENSIONS.find(([id]) => id === dimension);
  const totals = new Map();
  // Debts are left out: a strip can only divide up what is held.
  for (const x of state.data.holdings) if (x.value > 0) totals.set(keyOf(x), (totals.get(keyOf(x)) ?? 0) + x.value);
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
  return { total, rows: shown.map((r) => ({ ...r, share: r.value / total, color: colorOf(dimension, r.name) })) };
}

function renderAllocation() {
  $('dimension').replaceChildren(
    ...DIMENSIONS.map(([id, label]) =>
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': String(state.dimension === id),
          onclick: () => {
            state.dimension = id;
            renderAllocation();
          },
        },
        label,
      ),
    ),
  );

  const { total, rows } = groups(state.dimension);
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
          showTip(e, r.name, `${usd(r.value)} · ${percent(r.share)}`);
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
        h('span', { class: 'name' }, r.name),
        h('span', { class: 'num' }, usd(r.value)),
        h('span', { class: 'num share' }, percent(r.share)),
      ),
    ),
  );
  if (total === 0) legend.replaceChildren(h('li', { class: 'muted' }, 'Nothing to show yet.'));

  const top = state.data.assets.filter((a) => a.value > 0).slice(0, 5);
  const stable = state.data.assets.filter((a) => a.category === 'Stablecoins').reduce((s, a) => s + a.value, 0);
  $('allocation-notes').replaceChildren(
    h('h3', {}, 'Largest positions'),
    h(
      'ol',
      {},
      ...top.map((a) => h('li', {}, h('span', {}, a.key), h('span', { class: 'num muted' }, percent(a.share)))),
    ),
    h('h3', {}, 'Held in stablecoins'),
    h('p', { class: 'stable num' }, state.data.netWorth ? percent(stable / state.data.netWorth) : '—'),
  );
}

// ── History ──────────────────────────────────────────────────────────────────

let chart;

async function renderHistory() {
  $('period').replaceChildren(
    ...PERIODS.map(([id, label]) =>
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': String(state.period === id),
          onclick: () => {
            state.period = id;
            renderHistory();
          },
        },
        label,
      ),
    ),
  );

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

const COLUMNS = [
  ['key', 'Asset', ''],
  ['quantity', 'Quantity', 'optional'],
  ['price', 'Price', 'optional'],
  ['value', 'Value', ''],
  ['share', 'Share', ''],
  ['change1d', '24 h', ''],
  ['change7d', '7 d', 'optional'],
];

function renderPositions() {
  const { data, sort } = state;
  const table = $('positions');

  table.tHead.replaceChildren(
    h(
      'tr',
      {},
      ...COLUMNS.map(([key, label, cls]) =>
        h(
          'th',
          {
            class: cls,
            scope: 'col',
            'aria-sort': sort.key === key ? (sort.descending ? 'descending' : 'ascending') : null,
          },
          h(
            'button',
            {
              type: 'button',
              onclick: () => {
                state.sort = { key, descending: sort.key === key ? !sort.descending : key !== 'key' };
                renderPositions();
              },
            },
            label + (sort.key === key ? (sort.descending ? ' ↓' : ' ↑') : ''),
          ),
        ),
      ),
    ),
  );

  const dust = data.assets.filter((a) => Math.abs(a.value) < DUST_USD);
  const visible = state.showDust ? data.assets : data.assets.filter((a) => Math.abs(a.value) >= DUST_USD);
  const sorted = [...visible].sort((a, b) => {
    const [x, y] = [a[sort.key], b[sort.key]];
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
    body.append(
      h(
        'tr',
        { 'aria-expanded': String(open) },
        h(
          'td',
          {},
          h(
            'div',
            { class: 'asset' },
            h('span', { class: 'chevron', 'aria-hidden': 'true' }, '›'),
            h('span', { class: 'swatch', style: { background: colorOf('category', a.category) }, title: a.category }),
            h('button', { type: 'button', onclick: flip, 'aria-label': `${a.key}: show where it is held` }, a.key),
            h('span', { class: 'category optional' }, a.category),
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
        'table',
        {},
        h(
          'thead',
          {},
          h('tr', {}, ...['Account', 'Where', 'Held as', 'Quantity', 'Value'].map((t) => h('th', { scope: 'col' }, t))),
        ),
        h(
          'tbody',
          {},
          ...places.map((x) =>
            h(
              'tr',
              {},
              h('td', {}, x.account),
              h(
                'td',
                {},
                x.kind === 'binance' ? x.protocol : [chainName(x.chain), x.protocol].filter(Boolean).join(', '),
              ),
              h('td', {}, `${TYPES[x.type] ?? x.type}${x.symbol !== asset ? ` (${x.symbol})` : ''}`),
              h('td', { class: 'num' }, quantity(x.quantity)),
              h('td', { class: 'num' }, usd(x.value)),
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
          h('h3', {}, items[0].protocol),
          h(
            'p',
            { class: 'where' },
            `${chainName(items[0].chain)}, ${[...new Set(items.map((x) => x.account))].join(', ')}`,
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
                h('span', {}, x.symbol),
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
  const act = async (request) => {
    try {
      await request();
      state.renaming = state.removing = null;
      await load();
    } catch (err) {
      showFormError(err.message);
    }
  };

  $('wallets').replaceChildren(
    ...wallets.map((w) => {
      const renaming = state.renaming === w.id;
      const removing = state.removing === w.id;
      const input = renaming && h('input', { value: w.label, maxlength: 40, 'aria-label': 'Wallet name' });
      const save = () =>
        act(() => api(`/api/wallets/${w.id}`, { method: 'PATCH', body: JSON.stringify({ label: input.value }) }));
      if (input) input.addEventListener('keydown', (e) => e.key === 'Enter' && save());
      const button = (label, onclick) => h('button', { class: 'link', type: 'button', onclick }, label);
      const set = (patch) => () => {
        Object.assign(state, { renaming: null, removing: null }, patch);
        renderWallets();
      };

      return h(
        'li',
        {},
        renaming ? input : h('span', { class: 'label' }, w.label),
        h('span', { class: 'kind muted' }, KINDS[w.kind]),
        h('span', { class: 'address num muted' }, w.address),
        h('span', { class: 'num' }, w.status === null ? '—' : usd(w.value)),
        h(
          'span',
          { class: 'actions' },
          ...(renaming
            ? [button('Save name', save), button('Cancel', set({}))]
            : removing
              ? [
                  button('Remove wallet and its history', () =>
                    act(() => api(`/api/wallets/${w.id}`, { method: 'DELETE' })),
                  ),
                  button('Keep', set({})),
                ]
              : [button('Rename', set({ renaming: w.id })), button('Remove', set({ removing: w.id }))]),
        ),
        w.stale && h('p', { class: 'problem' }, `Last update failed, showing earlier data. ${w.error}`),
        w.status === null && h('p', { class: 'problem' }, 'Not collected yet. Choose Update now.'),
      );
    }),
  );
  if (wallets.length === 0) {
    $('wallets').replaceChildren(
      h('li', { class: 'muted' }, 'No wallets yet. Paste an address below to add the first one.'),
    );
  }
  $('wallets').querySelector('input')?.focus();
}

function showFormError(message) {
  const el = $('add-wallet-error');
  el.textContent = message ?? '';
  el.hidden = !message;
}

$('add-wallet').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  showFormError(null);
  try {
    await api('/api/wallets', {
      method: 'POST',
      body: JSON.stringify({ address: form.address.value, label: form.label.value }),
    });
    form.reset();
    await load();
    await update(); // read the new wallet straight away
  } catch (err) {
    showFormError(err.message);
  }
});

// ── Tooltip ──────────────────────────────────────────────────────────────────

function showTip(event, title, text) {
  const tip = $('tip');
  tip.replaceChildren(h('b', {}, title), text);
  tip.hidden = false;
  const { width } = tip.getBoundingClientRect();
  tip.style.left = `${Math.min(event.clientX + 14, window.innerWidth - width - 8)}px`;
  tip.style.top = `${event.clientY + 18}px`;
}

const hideTip = () => ($('tip').hidden = true);

// ── Loading ──────────────────────────────────────────────────────────────────

async function load() {
  state.data = await api('/api/portfolio');
  renderHeader();
  renderAllocation();
  renderPositions();
  renderDefi();
  renderWallets();
  await renderHistory();
  // A collection started elsewhere (the schedule, another tab) is still running: look again shortly.
  if (state.data.collecting) setTimeout(load, 4000);
}

async function update() {
  const button = $('collect');
  button.disabled = true;
  button.textContent = 'Updating…';
  try {
    await api('/api/collect', { method: 'POST', body: '{}' });
  } finally {
    await load();
  }
}

$('collect').addEventListener('click', update);
setInterval(load, 5 * 60 * 1000);

load().catch((err) => {
  $('updated').textContent =
    `Could not load the portfolio: ${err.message}. Check that the server is running, then reload.`;
});
