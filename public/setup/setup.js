import { post, showAuthenticator, showError, submit } from '/common/auth.js';
import { checkCode, checkName, checkNewPassword, checkRepeat, validate } from '/common/checks.js';

const account = document.getElementById('account');
const authenticator = document.getElementById('authenticator');

const checkSetupCode = (value) => {
  if (!value.trim()) return 'Enter the setup code. It is printed in the server log.';
  return value.toUpperCase().replace(/[^A-Z2-7]/g, '').length === 12
    ? null
    : 'The setup code has 12 characters, like ABCD-EFGH-JKLM.';
};

account.addEventListener('submit', (event) => {
  event.preventDefault();
  const valid = validate(
    account,
    [
      ['setupCode', checkSetupCode],
      ['username', checkName],
      ['password', checkNewPassword],
      ['repeat', checkRepeat(account)],
    ],
    (message) => showError(account, message),
  );
  if (!valid) return;
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
  if (!validate(authenticator, [['code', checkCode]], (message) => showError(authenticator, message))) return;
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
