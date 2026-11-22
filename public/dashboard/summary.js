import { h, help, icon, skeleton } from '/common/ui.js';
import { api } from './api.js';
import { openAdd } from './dialogs.js';
import { showBanner } from './feedback.js';
import { MASK, ago, change, inTime, money, moneyRound, percent, usd } from './format.js';
import { HELP, SOURCES, fearGreedTone } from './help.js';
import { kindLogo, kindLogoSpec } from './logos.js';
import { groups } from './overview.js';
import { renderSignals } from './signals.js';
import { $, DUST_USD, actions, busy, firstRead, state, viewing } from './state.js';
import { switchView } from './views.js';

const CHIP_LIMIT = 10;

function historyDue(days) {
  const since = state.data.historySince;
  if (!since) return 'after the first update';
  const due = Date.parse(since) + days * 86_400_000 - Date.now();
  return due > 0 ? `in ${inTime(due)}` : 'soon';
}

function periodFact(label, days, key) {
  const value = state.data.changes[key];
  const estimate = state.data.estimates[key];
  if (value != null) return h('div', {}, h('dt', {}, label), h('dd', {}, change(value)));
  if (!estimate) {
    const due = `Appears ${historyDue(days)}`;
    return h(
      'div',
      {},
      h('dt', {}, label),
      h(
        'dd',
        { title: due },
        h('span', { class: 'num muted', 'aria-hidden': 'true' }, '—'),
        h('span', { class: 'sr-only' }, due),
      ),
    );
  }
  const span = days === 1 ? '24 hours' : `${days} days`;
  return h(
    'div',
    { class: 'estimated' },
    h(
      'dt',
      {},
      label,
      help({
        title: `Estimated ${days === 1 ? '24-hour' : `${days}-day`} change`,
        text: `History does not reach ${span} back yet, so this is today's holdings priced ${span} ago. It covers ${Math.round(estimate.coverage * 100)}% of the portfolio: assets with a Binance market${days === 1 ? '' : ', tokens CoinGecko has prices for'}, and stablecoins at $1. Deposits, withdrawals and trades in between are not in it. The change from history takes over ${historyDue(days)}.`,
        source: days === 1 ? SOURCES.dayTicker : SOURCES.dailyPrices,
      }),
    ),
    h(
      'dd',
      {},
      h('span', { class: 'approx', 'aria-hidden': 'true' }, '≈'),
      h('span', { class: 'sr-only' }, 'About '),
      change(estimate.change),
    ),
  );
}

export function renderSummary() {
  const { data } = state;
  if (viewing) {
    const { name, rank, portfolios, you } = data.board;
    const place = [rank && `${rank} of ${portfolios}`, you && 'you'].filter(Boolean).join(', ');
    $('viewing-place').replaceChildren(h('b', {}, name), place && ` ${place}`);
  }
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
  privacy.querySelector('use').setAttribute('href', `#${state.hideAmounts ? 'eye-off' : 'eye'}`);
  $('views-worth').textContent = moneyRound(data.netWorth);

  $('facts').replaceChildren(
    periodFact('24 hours', 1, 'd1'),
    periodFact('7 days', 7, 'd7'),
    periodFact('30 days', 30, 'd30'),
    ...(data.fearGreed
      ? [
          h(
            'div',
            { class: `fear-greed ${fearGreedTone(data.fearGreed.value)}` },
            h('dt', {}, 'Fear & Greed', help(HELP.fearGreed)),
            h('dd', {}, h('b', {}, String(data.fearGreed.value)), h('small', {}, data.fearGreed.label)),
          ),
        ]
      : []),
  );
  renderUpdating();
  renderNotices();
}

let gateTimer;

const inMinutes = (at) => {
  const minutes = Math.max(1, Math.ceil((at - Date.now()) / 60_000));
  return minutes < 90 ? `${minutes} min` : `${Math.ceil(minutes / 60)} h`;
};
const startsIn = (ms) =>
  ms < 10_000
    ? 'Update starts in a few seconds'
    : ms < 60_000
      ? `Update starts in about ${Math.ceil(ms / 10_000) * 10} s`
      : `Update starts in about ${Math.ceil(ms / 60_000)} min`;
const labelOf = (id) => state.data?.sources.find((s) => s.id === id)?.label ?? 'an account';

export function renderUpdating() {
  const { data, progress } = state;
  const gate = data.update ?? { allowed: true };
  const button = $('collect');
  button.disabled = busy() || !gate.allowed;
  button.classList.toggle('spinning', busy());
  button.title = busy()
    ? 'Updating…'
    : gate.allowed
      ? 'Update now'
      : `${gate.reason}${gate.availableAt ? `. Available again in ${inMinutes(gate.availableAt)}` : ''}.`;
  clearTimeout(gateTimer);
  if (!busy() && !gate.allowed && gate.availableAt && gate.availableAt - Date.now() < 15 * 60_000) {
    gateTimer = setTimeout(actions.load, Math.max(1000, gate.availableAt - Date.now() + 500));
  }

  let line;
  if (progress?.phase === 'signals') line = 'Updating signals…';
  else if (progress) {
    const done = progress.accounts.filter((a) => a.state === 'done' || a.state === 'failed').length;
    const current = progress.accounts.find((a) => a.state === 'reading');
    if (current) {
      line = `${current.note ? `${labelOf(current.id)}: ${current.note}` : `Reading ${labelOf(current.id)}`} · ${done} of ${progress.accounts.length}`;
    } else if (progress.startsIn !== null && progress.startsIn !== undefined) {
      line = startsIn(progress.startsIn);
    } else line = `Updating · ${done} of ${progress.accounts.length}`;
  } else if (busy()) line = 'Updating…';
  else {
    line = data.updatedAt ? `Updated ${ago(data.updatedAt)}` : 'Not updated yet';
    if (!gate.allowed && gate.availableAt && gate.availableAt - Date.now() > 10 * 60_000) line += ` · ${gate.reason}`;
  }
  $('updated').textContent = line;
  renderSources();
}

export const isOld = (s) =>
  s.oldestRead && Date.now() - Date.parse(s.oldestRead) > 2 * state.data.collectEveryMinutes * 60_000;

function openAccounts() {
  switchView('accounts');
  window.scrollTo({ top: $('content').getBoundingClientRect().top + window.scrollY, behavior: 'instant' });
}

function keyed({ key, make }) {
  const element = make();
  element.dataset.key = key;
  return element;
}

function fillKeyed(list, items) {
  const current = [...list.children];
  if (current.length !== items.length) return list.replaceChildren(...items.map(keyed));
  items.forEach((item, i) => {
    if (current[i].dataset.key !== item.key) current[i].replaceWith(keyed(item));
  });
}

function sourceChip(s, step) {
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
  const value =
    (!mark || mark[0] === 'aged' || mark[0] === 'done' || mark[0] === 'waiting') && s.status !== null
      ? moneyRound(s.value)
      : null;
  const title = mark ? mark[2] : `${money(s.value)}, updated ${ago(s.collectedAt)}`;
  const logo = kindLogoSpec(s.kind);
  return {
    key: JSON.stringify([s.id, s.kind, s.label, state.logos.get(`${logo.kind}/${logo.key}`), mark, value, title]),
    make: () =>
      h(
        'li',
        { class: mark?.[0] ?? '', title },
        kindLogo(s.kind),
        h('span', { class: 'chip-label' }, s.label),
        value && h('span', { class: 'num muted' }, value),
        mark?.[1] && icon(mark[1]),
        mark && h('span', { class: 'sr-only' }, mark[2]),
      ),
  };
}

function renderSources() {
  const live = new Map((state.progress?.accounts ?? []).map((a) => [a.id, a]));
  const { sources } = state.data;
  const shown = sources.filter((s, i) => i < CHIP_LIMIT || s.status === null || s.stale);
  const more = sources.length - shown.length;
  fillKeyed($('sources'), [
    ...shown.map((s) => sourceChip(s, live.get(s.id))),
    ...(more > 0
      ? [
          {
            key: `more ${more} ${sources.length}`,
            make: () =>
              h(
                'li',
                { class: 'more-chip' },
                h(
                  'button',
                  { type: 'button', title: `All ${sources.length} accounts are in Accounts`, onclick: openAccounts },
                  `${more} more`,
                  icon('chevron-right'),
                ),
              ),
          },
        ]
      : []),
    {
      key: 'add',
      make: () =>
        h(
          'li',
          { class: 'add-chip' },
          h('button', { type: 'button', onclick: () => openAdd() }, icon('plus'), 'Add wallet or exchange'),
        ),
    },
  ]);
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
    ...['overheated', 'cold'].map(heatNotice).filter(Boolean),
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

const newlyIn = (zone) =>
  state.data.assets
    .filter((a) => a.signal?.zone === zone && !a.signal.dismissed && Math.abs(a.value) >= DUST_USD)
    .sort((a, b) => b.share - a.share);

const EXTREMES = {
  overheated: { word: 'overheated', tone: 'hot' },
  cold: { word: 'cold', tone: 'cold' },
};

async function dismissHeat(assets) {
  for (const a of assets) a.signal.dismissed = true;
  renderNotices();
  try {
    await api('/api/heat/dismiss', { method: 'POST', body: JSON.stringify({ assets: assets.map((a) => a.key) }) });
  } catch (err) {
    showBanner(err);
  }
}

function heatNotice(zone) {
  const assets = newlyIn(zone);
  if (assets.length === 0) return null;
  const { word, tone } = EXTREMES[zone];
  const share = assets.reduce((s, a) => s + Math.max(0, a.share), 0);
  const portion = share > 0 ? `, ${percent(share)} of the portfolio` : '';
  const text =
    assets.length === 1 ? ` is ${word} (${assets[0].signal.score.toFixed(0)})${portion}.` : ` are ${word}${portion}.`;
  return h(
    'li',
    { class: tone },
    icon(zone === 'cold' ? 'snowflake' : 'flame'),
    h('span', {}, h('b', {}, joinNames(assets.map((a) => a.key))), text),
    h(
      'span',
      { class: 'notice-actions' },
      h(
        'button',
        {
          class: 'link',
          type: 'button',
          onclick: () => {
            state.signalZone = zone;
            renderSignals();
            switchView('signals');
          },
        },
        'Show in Signals',
      ),
      h('button', { class: 'link', type: 'button', onclick: () => dismissHeat(assets) }, 'Dismiss'),
    ),
  );
}
