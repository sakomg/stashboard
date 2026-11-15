import { h, icon, iconButton } from '/common/ui.js';
import { api } from './api.js';
import { showBanner } from './feedback.js';
import { ago } from './format.js';
import { $, actions, state } from './state.js';
import { inMinutes } from './summary.js';

export async function setHideAmounts(hide) {
  state.hideAmounts = hide;
  $('hide-amounts').checked = hide;
  await actions.renderAll();
  try {
    await api('/api/preferences', { method: 'PUT', body: JSON.stringify({ hideAmounts: hide }) });
  } catch (err) {
    showBanner(err);
  }
}

$('privacy').addEventListener('click', () => setHideAmounts(!state.hideAmounts));
$('hide-amounts').addEventListener('change', (event) => setHideAmounts(event.target.checked));

export const shareUrl = (token) => `${location.origin}/s/${token}`;

export function timeLeft(iso) {
  const hours = Math.max(1, Math.round((Date.parse(iso) - Date.now()) / 3_600_000));
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`;
}

export async function renderShareLinks() {
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

export function renderAccountPanel() {
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
