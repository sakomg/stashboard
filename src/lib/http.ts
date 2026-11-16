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
  body?: string,
): Promise<{ data: T; headers: Headers }> {
  const host = new URL(url).host;
  let res: Response | undefined;
  for (let attempt = 1; !res; attempt++) {
    try {
      res = await fetch(url, {
        method,
        headers: { accept: 'application/json', ...headers },
        body,
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

export function getJson<T = unknown>(
  url: string | URL,
  headers: Record<string, string> = {},
  timeoutMs = 20_000,
): Promise<T> {
  return request<T>('GET', url, headers, timeoutMs).then((r) => r.data);
}

export function getJsonWithHeaders<T = unknown>(
  url: string | URL,
  headers: Record<string, string> = {},
  timeoutMs = 20_000,
): Promise<{ data: T; headers: Headers }> {
  return request<T>('GET', url, headers, timeoutMs);
}

export function postJson<T = unknown>(
  url: string | URL,
  headers: Record<string, string> = {},
  timeoutMs = 20_000,
): Promise<T> {
  return request<T>('POST', url, headers, timeoutMs).then((r) => r.data);
}

export function sendJson<T = unknown>(
  url: string | URL,
  body: unknown,
  headers: Record<string, string> = {},
  timeoutMs = 20_000,
): Promise<T> {
  return request<T>(
    'POST',
    url,
    { 'content-type': 'application/json', ...headers },
    timeoutMs,
    JSON.stringify(body),
  ).then((r) => r.data);
}
