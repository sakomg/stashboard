import { passwordsDiffer, post, showAuthenticator, showError, submit } from '/common/auth.js';

const account = document.getElementById('account');
const authenticator = document.getElementById('authenticator');

account.addEventListener('submit', (event) => {
  event.preventDefault();
  if (passwordsDiffer(account)) return;
  submit(account, async () => {
    showAuthenticator(
      await post('/api/setup/start', {
        setupCode: account.setupCode.value,
        name: account.username.value,
        password: account.password.value,
      }),
    );
    account.hidden = true;
    authenticator.hidden = false;
    authenticator.code.focus();
  });
});

authenticator.addEventListener('submit', (event) => {
  event.preventDefault();
  submit(authenticator, async () => {
    try {
      await post('/api/setup/finish', { setupCode: account.setupCode.value, code: authenticator.code.value });
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
  account.hidden = false;
  showError(authenticator, null);
  account.password.focus();
});
