export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = closes[i]! - closes[i - 1]!;
    if (delta > 0) gain += delta;
    else loss -= delta;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const delta = closes[i]! - closes[i - 1]!;
    gain = (gain * (period - 1) + Math.max(delta, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-delta, 0)) / period;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i]!;
  return sum / period;
}

export type PricePoint = [time: number, price: number];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const FIRST_MONDAY = Date.UTC(1970, 0, 5);

export function weeklyCloses(points: PricePoint[]): number[] {
  const weeks: number[] = [];
  let current: number | null = null;
  for (const [time, price] of points) {
    const week = Math.floor((time - 1 - FIRST_MONDAY) / WEEK_MS);
    if (week === current) weeks[weeks.length - 1] = price;
    else weeks.push(price);
    current = week;
  }
  return weeks;
}

export function priceChange(closes: number[], days: number): number | null {
  const last = closes.at(-1);
  const then = closes.length > days ? closes.at(-1 - days) : undefined;
  return last !== undefined && then !== undefined && then > 0 ? last / then - 1 : null;
}
