const form = document.getElementById('login');
const error = document.getElementById('error');
const button = form.querySelector('button');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  error.hidden = true;
  button.disabled = true;
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: form.password.value, code: form.code.value }),
    });
    if (response.ok) {
      location.replace('/');
      return;
    }
    const body = await response.json().catch(() => ({}));
    error.textContent = body.error ?? 'Could not sign in. Try again.';
  } catch {
    error.textContent = 'Could not reach the server. Check the connection and try again.';
  }
  error.hidden = false;
  button.disabled = false;
  form.code.value = '';
  form.code.focus();
});
