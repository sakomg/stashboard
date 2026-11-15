// Crypto Fear & Greed index from alternative.me. It changes once a day, so it is cached.
import { getJson } from '../http.ts';

export interface FearGreed {
  value: number;
  label: string;
}

const TTL_MS = 6 * 60 * 60 * 1000;
let cached: { at: number; data: FearGreed } | undefined;

/** Returns null when the index cannot be read; the dashboard works without it. */
export async function fearGreed(): Promise<FearGreed | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;
  try {
    const r = await getJson<{ data: { value: string; value_classification: string }[] }>(
      'https://api.alternative.me/fng/?limit=1',
      {},
      8000,
    );
    const d = r.data[0];
    if (!d) return cached?.data ?? null;
    cached = { at: Date.now(), data: { value: Number(d.value), label: d.value_classification } };
    return cached.data;
  } catch {
    return cached?.data ?? null;
  }
}
