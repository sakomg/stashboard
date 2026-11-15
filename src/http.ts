export class HttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(host: string, status: number, body: string) {
    super(`${host} → HTTP ${status}: ${body.slice(0, 300)}`);
    this.status = status;
    this.body = body;
  }
}

/**
 * GET with a timeout, JSON response. Error text carries only the host and the response body:
 * query strings and headers can contain keys and signatures.
 */
export async function getJson<T = unknown>(
  url: string | URL,
  headers: Record<string, string> = {},
  timeoutMs = 20_000,
): Promise<T> {
  const host = new URL(url).host;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const cause = err instanceof Error ? ((err.cause as Error | undefined)?.message ?? err.message) : String(err);
    throw new Error(`${host} → no response: ${cause}`);
  }
  const text = await res.text();
  if (!res.ok) throw new HttpError(host, res.status, text);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${host} → response is not JSON: ${text.slice(0, 200)}`);
  }
}
