import { getJson, HttpError } from '../lib/http.ts';
import type { PricePoint } from '../domain/indicators.ts';

const API = 'https://api.coingecko.com/api/v3';
const DAY_MS = 24 * 60 * 60 * 1000;

const PLATFORMS: Record<string, string> = {
  ethereum: 'ethereum',
  base: 'base',
  arbitrum: 'arbitrum-one',
  optimism: 'optimistic-ethereum',
  polygon: 'polygon-pos',
  'binance-smart-chain': 'binance-smart-chain',
  avalanche: 'avalanche',
  solana: 'solana',
  linea: 'linea',
  'zksync-era': 'zksync',
  scroll: 'scroll',
  blast: 'blast',
  mantle: 'mantle',
  xdai: 'xdai',
  sonic: 'sonic',
  berachain: 'berachain',
  unichain: 'unichain',
  abstract: 'abstract',
  ink: 'ink',
  zora: 'zora-network',
};

export const coingeckoPlatform = (chain: string): string | null => PLATFORMS[chain] ?? null;

export async function dailyCloses(apiKey: string, platform: string, address: string): Promise<PricePoint[] | null> {
  try {
    const { prices } = await getJson<{ prices?: [number, number][] }>(
      `${API}/coins/${platform}/contract/${encodeURIComponent(address)}/market_chart?vs_currency=usd&days=365&interval=daily`,
      apiKey ? { 'x-cg-demo-api-key': apiKey } : {},
    );
    return (prices ?? []).filter(([time, price]) => time % DAY_MS === 0 && price > 0);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return null;
    throw err;
  }
}
