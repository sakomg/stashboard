import { h, icon, iconButton } from '/common/ui.js';
import { checkName, validate } from '/common/checks.js';
import { api } from './api.js';
import { setError, submitDialog } from './dialogs.js';
import { fillList, timeLeft } from './settings.js';
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

async function showInvite(token, expiresAt) {
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

async function renderPeople() {
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
  fillList(
    $('people-list'),
    people.map((person) =>
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
    4,
  );
  fillList(
    $('invite-list'),
    invites.map((invite) =>
      h(
        'li',
        {},
        h(
          'div',
          {},
          h('b', {}, 'Invite link'),
          h(
            'small',
            {},
            `Not used yet, works for ${timeLeft(invite.expiresAt)} more`,
            !invite.token && '. Its link cannot be shown again',
          ),
        ),
        h(
          'span',
          { class: 'actions' },
          invite.token && iconButton('copy', 'Copy this invite link', () => showInvite(invite.token, invite.expiresAt)),
          iconButton('trash-2', 'Turn off this invite link', () => turnOffInvite(invite)),
        ),
      ),
    ),
    2,
  );
}

$('invite').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  setError('people-error', null);
  try {
    const { token, expiresAt } = await api('/api/invites', { method: 'POST', body: '{}' });
    await showInvite(token, expiresAt);
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

let editingName = false;

function renderMe() {
  const { me, loginEnabled } = state.data ?? {};
  const box = $('me');
  box.hidden = !(loginEnabled && me);
  if (box.hidden) return;
  if (!editingName) {
    box.replaceChildren(
      h('b', { class: 'me-name' }, me.name),
      iconButton(
        'pencil',
        'Change the name you sign in with',
        () => {
          editingName = true;
          renderMe();
        },
        'small',
      ),
    );
    return;
  }
  const form = h(
    'form',
    { class: 'name-form', novalidate: true },
    h(
      'div',
      { class: 'name-row' },
      h('input', {
        name: 'username',
        value: me.name,
        autocomplete: 'username',
        autocapitalize: 'off',
        spellcheck: 'false',
        'aria-label': 'Name you sign in with',
      }),
      h(
        'button',
        { class: 'icon-button confirm', type: 'submit', 'aria-label': 'Save name', title: 'Save name' },
        icon('check'),
      ),
      iconButton('x', 'Cancel', () => stopEditing()),
    ),
    h('p', { class: 'form-error', id: 'name-error', role: 'alert', hidden: true }),
  );
  const input = form.elements.namedItem('username');
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    stopEditing();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!validate(form, [['username', checkName]], (message) => setError('name-error', message))) return;
    const buttons = [...form.querySelectorAll('button')];
    buttons.forEach((b) => (b.disabled = true));
    try {
      const { name } = await api('/api/me', { method: 'PATCH', body: JSON.stringify({ name: input.value }) });
      state.data.me.name = name;
      stopEditing();
      renderPeople();
    } catch (err) {
      setError('name-error', err.message);
      buttons.forEach((b) => (b.disabled = false));
    }
  });
  box.replaceChildren(form);
  input.focus();
  input.select();
}

function stopEditing() {
  editingName = false;
  renderMe();
  $('me').querySelector('button')?.focus();
}

$('open-account').addEventListener('click', () => {
  editingName = false;
  renderMe();
  setError('people-error', null);
  $('invite-status').hidden = true;
  renderPeople();
});
