import { setTimeout as sleep } from 'node:timers/promises';

export class HttpError extends Error {
  readonly status: number;
  readonly body: string;
  readonly headers: Headers;

  constructor(host: string, status: number, body: string, headers: Headers = new Headers()) {
    super(`${host} → HTTP ${status}: ${body.replace(/\s+/g, ' ').slice(0, 300)}`);
    this.status = status;
    this.body = body;
    this.headers = headers;
  }
}

const NETWORK_ATTEMPTS = 3;

async function request<T>(
  method: 'GET' | 'POST',
  url: string | URL,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ data: T; headers: Headers }> {
  const host = new URL(url).host;
  let res: Response | undefined;
  // Only connection failures are retried, and every request here is a read, so a repeat is safe.
  for (let attempt = 1; !res; attempt++) {
    try {
      res = await fetch(url, {
        method,
        headers: { accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (attempt < NETWORK_ATTEMPTS) {
        await sleep(1000 * attempt);
        continue;
      }
      const cause = err instanceof Error ? ((err.cause as Error | undefined)?.message ?? err.message) : String(err);
      throw new Error(`${host} → no response: ${cause}`);
    }
  }
  const text = await res.text();
  if (!res.ok) throw new HttpError(host, res.status, text, res.headers);
  try {
    return { data: JSON.parse(text) as T, headers: res.headers };
  } catch {
    throw new Error(`${host} → response is not JSON: ${text.slice(0, 200)}`);
  }
}

/**
 * GET with a timeout, JSON response. Error text carries only the host and the response body:
 * query strings and headers can contain keys and signatures.
 */
export function getJson<T = unknown>(
  url: string | URL,
  headers: Record<string, string> = {},
  timeoutMs = 20_000,
): Promise<T> {
  return request<T>('GET', url, headers, timeoutMs).then((r) => r.data);
}

/** GET that also returns the response headers, for APIs that report their rate limits there. */
export function getJsonWithHeaders<T = unknown>(
  url: string | URL,
  headers: Record<string, string> = {},
  timeoutMs = 20_000,
): Promise<{ data: T; headers: Headers }> {
  return request<T>('GET', url, headers, timeoutMs);
}

/** POST without a body (parameters in the query string), JSON response. */
export function postJson<T = unknown>(
  url: string | URL,
  headers: Record<string, string> = {},
  timeoutMs = 20_000,
): Promise<T> {
  return request<T>('POST', url, headers, timeoutMs).then((r) => r.data);
}
