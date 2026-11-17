import { h, help, icon, skeleton } from '/common/ui.js';
import { api } from './api.js';
import { openAdd } from './dialogs.js';
import { showBanner } from './feedback.js';
import { MASK, ago, change, inTime, money, moneyRound, percent, usd } from './format.js';
import { HELP, SOURCES, fearGreedTone } from './help.js';
import { kindLogo } from './logos.js';
import { groups } from './overview.js';
import { renderSignals } from './signals.js';
import { $, DUST_USD, actions, busy, firstRead, state } from './state.js';
import { switchView } from './views.js';

export const CHIP_LIMIT = 10;

export function historyDue(days) {
  const since = state.data.historySince;
  if (!since) return 'after the first update';
  const due = Date.parse(since) + days * 86_400_000 - Date.now();
  return due > 0 ? `in ${inTime(due)}` : 'soon';
}

export const pendingChange = (days) => h('span', { class: 'pending' }, historyDue(days));

export const changeOrPending = (value, days) => (value == null ? pendingChange(days) : change(value));

export function periodFact(label, days, key) {
  const value = state.data.changes[key];
  const estimate = state.data.estimates?.[key];
  if (value != null || !estimate) return h('div', {}, h('dt', {}, label), h('dd', {}, changeOrPending(value, days)));
  return h(
    'div',
    { class: 'estimated' },
    h(
      'dt',
      {},
      label,
      help({
        title: `Estimated ${days}-day change`,
        text: `History does not reach ${days} days back yet, so this is today's holdings priced ${days} days ago. It covers ${Math.round(estimate.coverage * 100)}% of the portfolio: assets with a Binance market, and stablecoins at $1. Deposits, withdrawals and trades in between are not in it. The change from history takes over ${historyDue(days)}.`,
        source: SOURCES.dailyPrices,
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
    periodFact('7 days', 7, 'd7'),
    periodFact('30 days', 30, 'd30'),
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

export let gateTimer;

export const inMinutes = (at) => {
  const minutes = Math.max(1, Math.ceil((at - Date.now()) / 60_000));
  return minutes < 90 ? `${minutes} min` : `${Math.ceil(minutes / 60)} h`;
};
export const labelOf = (id) => state.data?.sources.find((s) => s.id === id)?.label ?? 'an account';

export function renderUpdating() {
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
    gateTimer = setTimeout(actions.load, Math.max(1000, gate.availableAt - Date.now() + 500));
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

export const isOld = (s) =>
  s.oldestRead && Date.now() - Date.parse(s.oldestRead) > 2 * state.data.collectEveryMinutes * 60_000;

export function openAccounts() {
  switchView('accounts');
  window.scrollTo({ top: $('content').getBoundingClientRect().top + window.scrollY, behavior: 'instant' });
}

export function renderSources() {
  const live = new Map((state.progress?.accounts ?? []).map((a) => [a.id, a]));
  const { sources } = state.data;
  const shown = sources.filter((s, i) => i < CHIP_LIMIT || s.status === null || s.stale);
  const more = sources.length - shown.length;
  $('sources').replaceChildren(
    ...shown.map((s) => {
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
    ...(more > 0
      ? [
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
        ]
      : []),
    h(
      'li',
      { class: 'add-chip' },
      h('button', { type: 'button', onclick: () => openAdd() }, icon('plus'), 'Add wallet or exchange'),
    ),
  );
}

export const joinNames = (names) =>
  names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

export function renderNotices() {
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
    heatNotice(),
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

export const newlyOverheated = () =>
  state.data.assets
    .filter((a) => a.signal?.zone === 'overheated' && !a.signal.dismissed && Math.abs(a.value) >= DUST_USD)
    .sort((a, b) => b.share - a.share);

async function dismissHeat(assets) {
  for (const a of assets) a.signal.dismissed = true;
  renderNotices();
  try {
    await api('/api/heat/dismiss', { method: 'POST', body: JSON.stringify({ assets: assets.map((a) => a.key) }) });
  } catch (err) {
    showBanner(err);
  }
}

function heatNotice() {
  const hot = newlyOverheated();
  if (hot.length === 0) return null;
  const share = hot.reduce((s, a) => s + Math.max(0, a.share), 0);
  const [first] = hot;
  const text =
    hot.length === 1
      ? ` turned overheated ${ago(first.signal.overheatedSince)}, with heat ${first.signal.score.toFixed(0)}.${share > 0 ? ` It is ${percent(share)} of the portfolio.` : ''}`
      : ` turned overheated.${share > 0 ? ` Together they are ${percent(share)} of the portfolio.` : ''}`;
  return h(
    'li',
    { class: 'hot' },
    icon('flame'),
    h('span', {}, h('b', {}, joinNames(hot.map((a) => a.key))), text),
    h(
      'span',
      { class: 'notice-actions' },
      h(
        'button',
        {
          class: 'link',
          type: 'button',
          onclick: () => {
            state.signalZone = 'overheated';
            renderSignals();
            switchView('signals');
          },
        },
        'Show in Signals',
      ),
      h('button', { class: 'link', type: 'button', onclick: () => dismissHeat(hot) }, 'Dismiss'),
    ),
  );
}
