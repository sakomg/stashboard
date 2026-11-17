import { post, showAuthenticator, showError, submit } from '/common/auth.js';
import { checkCode, checkNewPassword, checkRepeat, validate } from '/common/checks.js';

const details = document.getElementById('details');
const authenticator = document.getElementById('authenticator');
const token = () => location.hash.slice(1);

function needLink() {
  const missing = !token();
  showError(
    details,
    missing ? 'This page opens from a reset link. Ask the person who runs this dashboard for one.' : null,
  );
  details.querySelector('button[type=submit]').disabled = missing;
}

needLink();
window.addEventListener('hashchange', needLink);

details.addEventListener('submit', (event) => {
  event.preventDefault();
  const valid = validate(
    details,
    [
      ['password', checkNewPassword],
      ['repeat', checkRepeat(details)],
    ],
    (message) => showError(details, message),
  );
  if (!valid) return;
  submit(details, async () => {
    const started = await post('/api/reset/start', { token: token(), password: details.password.value });
    showAuthenticator(started);
    document.getElementById('name').textContent = started.name;
    details.hidden = true;
    authenticator.hidden = false;
    authenticator.code.focus();
  });
});

authenticator.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!validate(authenticator, [['code', checkCode]], (message) => showError(authenticator, message))) return;
  submit(authenticator, async () => {
    try {
      await post('/api/reset/finish', { token: token(), code: authenticator.code.value });
    } catch (err) {
      authenticator.code.value = '';
      authenticator.code.focus();
      throw err;
    }
    location.replace('/');
  });
});

document.getElementById('back').addEventListener('click', () => {
  authenticator.hidden = true;
  details.hidden = false;
  showError(authenticator, null);
  details.password.focus();
});
