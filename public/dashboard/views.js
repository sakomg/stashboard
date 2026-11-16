import { isExchange } from './logos.js';
import { chart } from './overview.js';
import { $, DUST_USD, busy, state } from './state.js';

export const VIEWS = ['overview', 'positions', 'signals', 'defi', 'accounts'];
export const tabs = () => [...document.querySelectorAll('[role="tab"]')];

export function showView(id, focus = false) {
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

export function renderCounts() {
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
    String(new Set(data.holdings.filter((x) => x.protocol && !isExchange(x.kind)).map((x) => x.protocol)).size || ''),
  );
  const troubled = data.sources.filter((s) => s.stale || (s.status === null && !busy())).length;
  set('accounts', troubled ? `${troubled} !` : String(data.sources.length), troubled ? 'warn' : '');
}

const mirrorView = () => {
  if (location.hash !== `#${state.view}`) history.replaceState(null, '', `#${state.view}`);
};

export function switchView(view, focus = false) {
  showView(view, focus);
  mirrorView();
  const top = $('content').getBoundingClientRect().top + window.scrollY;
  if (window.scrollY > top) window.scrollTo({ top, behavior: 'instant' });
}

for (const tab of tabs()) {
  tab.addEventListener('click', () => switchView(tab.dataset.view));
  tab.addEventListener('keydown', (e) => {
    const list = tabs();
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = list[(list.indexOf(tab) + step + list.length) % list.length];
    switchView(next.dataset.view, true);
  });
}
document.addEventListener(
  'click',
  (e) => {
    const view = e.target.closest?.('a[href^="#"]')?.getAttribute('href').slice(1);
    if (!VIEWS.includes(view)) return;
    e.preventDefault();
    switchView(view);
  },
  true,
);
window.addEventListener('hashchange', mirrorView);
showView(location.hash.slice(1));

new IntersectionObserver(([entry]) => $('views').classList.toggle('stuck', !entry.isIntersecting), {
  rootMargin: '-60px 0px 0px 0px',
}).observe($('net-worth'));
