export async function api(path, options) {
  let response;
  try {
    response = await fetch(
      path,
      options?.body === undefined ? options : { ...options, headers: { 'content-type': 'application/json' } },
    );
  } catch {
    throw new Error('The server did not answer. Check the connection.');
  }
  if (response.status === 401) {
    location.replace('/login');
    return new Promise(() => {});
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw Object.assign(new Error(body.error ?? `Request failed (${response.status})`), { status: response.status });
  }
  return body;
}
