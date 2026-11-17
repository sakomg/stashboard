import { getJson, HttpError } from '../lib/http.ts';

const SPOT = 'https://api.binance.com';
const FUTURES = 'https://fapi.binance.com';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface Markets {
  spot: Set<string>;
  futures: Set<string>;
}

export async function listMarkets(): Promise<Markets> {
  const [spot, futures] = await Promise.all([
    getJson<{ symbol: string }[]>(`${SPOT}/api/v3/ticker/price`),
    getJson<{ symbol: string }[]>(`${FUTURES}/fapi/v1/premiumIndex`),
  ]);
  return { spot: new Set(spot.map((s) => s.symbol)), futures: new Set(futures.map((s) => s.symbol)) };
}

export async function closes(
  market: 'spot' | 'futures',
  symbol: string,
  interval: '1d' | '1w',
  limit: number,
): Promise<number[]> {
  const base = market === 'spot' ? `${SPOT}/api/v3/klines` : `${FUTURES}/fapi/v1/klines`;
  const rows = await getJson<unknown[][]>(`${base}?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  return rows.map((r) => Number(r[4]));
}

export async function change24h(market: 'spot' | 'futures', symbol: string): Promise<number | null> {
  const base = market === 'spot' ? `${SPOT}/api/v3/ticker/24hr` : `${FUTURES}/fapi/v1/ticker/24hr`;
  const { priceChangePercent } = await getJson<{ priceChangePercent?: string }>(`${base}?symbol=${symbol}`);
  const percent = Number(priceChangePercent);
  return priceChangePercent !== undefined && Number.isFinite(percent) ? percent / 100 : null;
}

export async function funding8hPct(symbol: string, now = Date.now()): Promise<number | null> {
  const rows = await getJson<{ fundingRate: string }[]>(
    `${FUTURES}/fapi/v1/fundingRate?symbol=${symbol}&startTime=${now - 3 * DAY_MS}&limit=1000`,
  );
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + Number(r.fundingRate), 0);
  return (total / 9) * 100;
}

export async function openInterestChange7dPct(symbol: string): Promise<number | null> {
  try {
    const rows = await getJson<{ sumOpenInterest: string }[]>(
      `${FUTURES}/futures/data/openInterestHist?symbol=${symbol}&period=1d&limit=8`,
    );
    const first = Number(rows[0]?.sumOpenInterest);
    const last = Number(rows.at(-1)?.sumOpenInterest);
    if (rows.length < 8 || !first || !last) return null;
    return (last / first - 1) * 100;
  } catch (err) {
    if (err instanceof HttpError && err.status === 400) return null;
    throw err;
  }
}
