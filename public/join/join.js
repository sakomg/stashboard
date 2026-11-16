import { passwordsDiffer, post, showAuthenticator, showError, submit } from '/common/auth.js';

const details = document.getElementById('details');
const authenticator = document.getElementById('authenticator');
const token = () => location.hash.slice(1);

function needLink() {
  const missing = !token();
  showError(
    details,
    missing ? 'This page opens from an invite link. Ask the person who runs this dashboard for one.' : null,
  );
  details.querySelector('button[type=submit]').disabled = missing;
}

needLink();
window.addEventListener('hashchange', needLink);

details.addEventListener('submit', (event) => {
  event.preventDefault();
  if (passwordsDiffer(details)) return;
  submit(details, async () => {
    showAuthenticator(
      await post('/api/join/start', { token: token(), name: details.username.value, password: details.password.value }),
    );
    details.hidden = true;
    authenticator.hidden = false;
    authenticator.code.focus();
  });
});

authenticator.addEventListener('submit', (event) => {
  event.preventDefault();
  submit(authenticator, async () => {
    try {
      await post('/api/join/finish', { token: token(), code: authenticator.code.value });
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
