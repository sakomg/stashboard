import { h, icon } from '/common/ui.js';
import { $, actions, state } from './state.js';

export function showTip(event, title, text) {
  const tip = $('tip');
  tip.replaceChildren(h('b', {}, title), text);
  tip.hidden = false;
  const { width } = tip.getBoundingClientRect();
  tip.style.left = `${Math.min(event.clientX + 14, window.innerWidth - width - 8)}px`;
  tip.style.top = `${event.clientY + 18}px`;
}

export const hideTip = () => ($('tip').hidden = true);

export function showInfo(text) {
  const banner = $('banner');
  banner.className = 'banner info';
  banner.replaceChildren(
    icon('circle-help'),
    h('span', {}, text),
    h('button', { class: 'link', type: 'button', onclick: () => (banner.hidden = true) }, 'Dismiss'),
  );
  banner.hidden = false;
}

export function showBanner(err) {
  $('banner').className = 'banner';
  const banner = $('banner');
  banner.replaceChildren(
    icon('triangle-alert'),
    h(
      'span',
      {},
      `${state.data ? 'The dashboard could not be refreshed.' : 'The dashboard could not be loaded.'} ${err.message} `,
    ),
    h('button', { class: 'link', type: 'button', onclick: () => actions.load() }, 'Try again'),
  );
  banner.hidden = false;
  if (!state.data) $('updated').textContent = 'Not loaded';
}
