import { setTimeout as sleep } from 'node:timers/promises';
import { getJson } from '../lib/http.ts';

interface FearGreed {
  value: number;
  label: string;
}

const TTL_MS = 6 * 60 * 60 * 1000;
let cached: { at: number; data: FearGreed } | undefined;
let pending: Promise<FearGreed | null> | null = null;

function refresh(): Promise<FearGreed | null> {
  pending ??= getJson<{ data: { value: string; value_classification: string }[] }>(
    'https://api.alternative.me/fng/?limit=1',
    {},
    8000,
  )
    .then((r) => {
      const d = r.data[0];
      if (d) cached = { at: Date.now(), data: { value: Number(d.value), label: d.value_classification } };
      return cached?.data ?? null;
    })
    .catch(() => cached?.data ?? null)
    .finally(() => {
      pending = null;
    });
  return pending;
}

export async function fearGreed(waitMs = 1500): Promise<FearGreed | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.data;
  const fresh = refresh();
  if (cached) return cached.data;
  return Promise.race([fresh, sleep(waitMs).then(() => null)]);
}
