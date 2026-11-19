import { checkCode, checkFilled, validate } from '/common/checks.js';
import { h } from '/common/ui.js';
import { api } from './api.js';
import { setError, submitDialog } from './dialogs.js';
import { $, state } from './state.js';

const form = $('backup-form');

async function download(body) {
  const blob = await api('/api/backup', { method: 'POST', body: JSON.stringify(body), blob: true });
  const url = URL.createObjectURL(blob);
  const link = h('a', { href: url, download: `stashboard-${new Date().toISOString().slice(0, 10)}.db` });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

$('backup-open').addEventListener('click', async (event) => {
  setError('backup-error', null);
  if (state.data.loginEnabled) {
    form.reset();
    setError('backup-dialog-error', null);
    $('backup-dialog').showModal();
    form.password.focus();
    return;
  }
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await download({});
  } catch (err) {
    setError('backup-error', err.message);
  } finally {
    button.disabled = false;
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const checks = [
    ['password', checkFilled('Enter your password.')],
    ['code', checkCode],
  ];
  if (!validate(form, checks, (message) => setError('backup-dialog-error', message))) return;
  await submitDialog(form, 'backup-dialog-error', () =>
    download({ password: form.password.value, code: form.code.value.replace(/\s/g, '') }),
  );
  form.password.value = '';
  form.code.value = '';
});

$('open-account').addEventListener('click', () => {
  setError('backup-error', null);
});
