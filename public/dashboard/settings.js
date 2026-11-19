import { h, icon, iconButton } from '/common/ui.js';
import { api } from './api.js';
import { setOnBoard } from './board.js';
import { showBanner } from './feedback.js';
import { $, actions, state } from './state.js';

async function setHideAmounts(hide) {
  state.hideAmounts = hide;
  await actions.renderAll();
  try {
    await api('/api/preferences', { method: 'PUT', body: JSON.stringify({ hideAmounts: hide }) });
  } catch (err) {
    showBanner(err);
  }
}

$('privacy').addEventListener('click', () => setHideAmounts(!state.hideAmounts));
$('on-board').addEventListener('change', (event) => setOnBoard(event.target.checked));

export const shareUrl = (token) => `${location.origin}/s/${token}`;

const unfolded = new Set();

export function fillList(list, rows, limit, count = rows.length) {
  const toggle = $(`${list.id}-more`);
  const folds = rows.length > limit + 1;
  const open = folds && unfolded.has(list.id);
  list.replaceChildren(...(folds && !open ? rows.slice(0, limit) : rows));
  const counter = $(`${list.id}-count`);
  if (counter) counter.textContent = count > 0 ? String(count) : '';
  toggle.hidden = !folds;
  toggle.setAttribute('aria-expanded', String(open));
  toggle.replaceChildren(open ? 'Show fewer' : `Show all ${rows.length}`, icon(open ? 'chevron-up' : 'chevron-down'));
  toggle.onclick = () => {
    if (open) unfolded.delete(list.id);
    else unfolded.add(list.id);
    fillList(list, rows, limit, count);
  };
}

export function timeLeft(iso) {
  const hours = Math.max(1, Math.round((Date.parse(iso) - Date.now()) / 3_600_000));
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`;
}

async function renderShareLinks() {
  const list = $('share-links');
  let links;
  try {
    links = await api('/api/shares');
  } catch (err) {
    $('shared-links').hidden = false;
    fillList(list, [h('li', { class: 'muted' }, err.message)], 3, 0);
    return;
  }
  $('shared-links').hidden = links.length === 0;
  fillList(
    list,
    links.map((link) =>
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
    3,
  );
}

export function renderAccountPanel() {
  const { data } = state;
  const z = data.zerion;
  $('on-board').checked = state.board?.onBoard ?? false;
  $('privacy-settings').hidden = !state.board?.others;
  $('session-text').hidden = data.loginEnabled;
  $('server').hidden = !data.me?.admin;
  const fact = (term, description) => h('div', {}, h('dt', {}, term), h('dd', {}, description));
  const every = (minutes) =>
    minutes < 120 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
  $('server-facts').replaceChildren(
    fact('Updates', `Every ${every(data.collectEveryMinutes)}`),
    ...(z?.dayLimit != null ? [fact('Zerion', `${z.dayRemaining ?? '?'} of ${z.dayLimit} requests left today`)] : []),
  );
}

$('open-account').addEventListener('click', () => {
  unfolded.clear();
  renderAccountPanel();
  renderShareLinks();
  $('account').showModal();
});
