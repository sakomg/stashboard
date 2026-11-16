export function showError(form, message) {
  const error = form.querySelector('.form-error');
  error.textContent = message ?? '';
  error.hidden = !message;
}

export async function post(path, body) {
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

export async function submit(form, request) {
  const button = form.querySelector('button[type=submit]');
  showError(form, null);
  button.disabled = true;
  try {
    await request();
  } catch (err) {
    showError(form, err.message);
  } finally {
    button.disabled = false;
  }
}

export function showAuthenticator({ key, qr }) {
  document.getElementById('qr').src = `data:image/svg+xml,${encodeURIComponent(qr)}`;
  document.getElementById('key').textContent = key;
}
