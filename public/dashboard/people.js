import { h, iconButton } from '/common/ui.js';
import { checkName, validate } from '/common/checks.js';
import { api } from './api.js';
import { setError, submitDialog } from './dialogs.js';
import { renderAccountPanel, timeLeft } from './settings.js';
import { $, state } from './state.js';

let removing = null;

const accountsText = (n) => (n === 0 ? 'No accounts yet' : n === 1 ? '1 account' : `${n} accounts`);

function openRemovePerson(person) {
  removing = person;
  setError('remove-person-error', null);
  $('remove-person-title').textContent = `Remove ${person.name}`;
  $('remove-person-text').replaceChildren(
    h('b', {}, person.name),
    ' can no longer sign in, and their accounts, history, categories and shared links are deleted. Nothing changes on their wallets or exchanges. A copy of the database is saved in the backups folder on the server first.',
  );
  $('remove-person-dialog').showModal();
}

async function turnOffInvite(invite) {
  try {
    await api(`/api/invites/${invite.id}`, { method: 'DELETE' });
    $('invite-status').hidden = true;
  } catch (err) {
    setError('people-error', err.message);
  }
  renderPeople();
}

export async function renderPeople() {
  const { me, loginEnabled } = state.data ?? {};
  $('people').hidden = !(me?.admin && loginEnabled);
  if ($('people').hidden) return;
  let people;
  let invites;
  try {
    [people, invites] = await Promise.all([api('/api/users'), api('/api/invites')]);
  } catch (err) {
    setError('people-error', err.message);
    return;
  }
  $('people-list').replaceChildren(
    ...people.map((person) =>
      h(
        'li',
        {},
        h(
          'div',
          {},
          h('b', {}, person.name),
          h('small', {}, person.you ? 'You, the admin' : accountsText(person.accounts)),
        ),
        !person.you &&
          h(
            'span',
            { class: 'actions' },
            iconButton('trash-2', `Remove ${person.name}`, () => openRemovePerson(person)),
          ),
      ),
    ),
    ...invites.map((invite) =>
      h(
        'li',
        {},
        h(
          'div',
          {},
          h('b', {}, 'Invite link'),
          h('small', {}, `Not used yet, works for ${timeLeft(invite.expiresAt)} more`),
        ),
        h(
          'span',
          { class: 'actions' },
          iconButton('trash-2', 'Turn off this invite link', () => turnOffInvite(invite)),
        ),
      ),
    ),
  );
}

$('invite').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  setError('people-error', null);
  try {
    const { token, expiresAt } = await api('/api/invites', { method: 'POST', body: '{}' });
    const url = `${location.origin}/join#${token}`;
    let copied = true;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      copied = false;
    }
    $('invite-status').replaceChildren(
      copied ? 'Link copied: ' : 'Link: ',
      h('a', { href: url, target: '_blank', rel: 'noopener' }, url),
      `. It works once, for ${timeLeft(expiresAt)}. Send it to one person privately: whoever opens it first can join.`,
    );
    $('invite-status').hidden = false;
    await renderPeople();
  } catch (err) {
    setError('people-error', err.message);
  } finally {
    button.disabled = false;
  }
});

$('remove-person-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const removed = await submitDialog(event.currentTarget, 'remove-person-error', () =>
    api(`/api/users/${removing.id}`, { method: 'DELETE' }),
  );
  if (removed) renderPeople();
});

const nameForm = $('name-form');
nameForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!validate(nameForm, [['username', checkName]], (message) => setError('name-error', message))) return;
  const button = nameForm.querySelector('button[type=submit]');
  button.disabled = true;
  setError('name-error', null);
  try {
    const { name } = await api('/api/me', { method: 'PATCH', body: JSON.stringify({ name: nameForm.username.value }) });
    state.data.me.name = name;
    nameForm.username.value = name;
    renderAccountPanel();
    renderPeople();
  } catch (err) {
    setError('name-error', err.message);
  } finally {
    button.disabled = false;
  }
});

$('open-account').addEventListener('click', () => {
  setError('name-error', null);
  nameForm.username.value = state.data?.me?.name ?? '';
  setError('people-error', null);
  $('invite-status').hidden = true;
  renderPeople();
});
