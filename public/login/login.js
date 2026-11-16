import { post, showError, submit } from '/common/auth.js';
import { checkCode, checkFilled, validate } from '/common/checks.js';

const form = document.getElementById('login');

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const valid = validate(
    form,
    [
      ['username', checkFilled('Enter your name.')],
      ['password', (value) => (value ? null : 'Enter your password.')],
      ['code', checkCode],
    ],
    (message) => showError(form, message),
  );
  if (!valid) return;
  submit(form, async () => {
    try {
      await post('/api/login', { name: form.username.value, password: form.password.value, code: form.code.value });
    } catch (err) {
      form.code.value = '';
      form.code.focus();
      throw err;
    }
    location.replace('/');
  });
});
