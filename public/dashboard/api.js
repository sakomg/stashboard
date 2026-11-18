export async function api(path, options) {
  const { blob, ...init } = options ?? {};
  let response;
  try {
    response = await fetch(
      path,
      init.body === undefined ? init : { ...init, headers: { 'content-type': 'application/json' } },
    );
  } catch {
    throw new Error('The server did not answer. Check the connection.');
  }
  if (response.status === 401) {
    location.replace('/login');
    return new Promise(() => {});
  }
  if (blob && response.ok) return response.blob();
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(body.error ?? `Request failed (${response.status})`), { status: response.status });
  }
  return body;
}
