const account = document.getElementById('account');
const authenticator = document.getElementById('authenticator');

function show(form, message) {
  const error = form.querySelector('.form-error');
  error.textContent = message ?? '';
  error.hidden = !message;
}

async function post(path, body) {
  let response;
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Could not reach the server. Check the connection and try again.');
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? 'Something went wrong. Try again.');
  return data;
}

/** Runs a form's request with its button disabled, showing any error under the form. */
async function submit(form, request) {
  const button = form.querySelector('button[type=submit]');
  show(form, null);
  button.disabled = true;
  try {
    await request();
  } catch (err) {
    show(form, err.message);
  } finally {
    button.disabled = false;
  }
}

account.addEventListener('submit', (event) => {
  event.preventDefault();
  if (account.password.value !== account.repeat.value) {
    show(account, 'The two passwords are different. Type them again.');
    return;
  }
  submit(account, async () => {
    const { key, qr } = await post('/api/setup/start', {
      setupCode: account.setupCode.value,
      password: account.password.value,
    });
    document.getElementById('qr').src = `data:image/svg+xml,${encodeURIComponent(qr)}`;
    document.getElementById('key').textContent = key;
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
  show(authenticator, null);
  account.password.focus();
});
