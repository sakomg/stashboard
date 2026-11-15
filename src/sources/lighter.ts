import { getJson, HttpError } from '../lib/http.ts';
import type { CollectResult, Holding } from '../domain/types.ts';

export const LIGHTER_VENUES = [
  { chain: 'ethereum', host: 'https://mainnet.zklighter.elliot.ai', collateral: 'USDC' },
  { chain: 'robinhood', host: 'https://api.rh.lighter.xyz', collateral: 'USDG' },
];

export const LIGHTER_PROTOCOL = 'Lighter';
const PROTOCOL = LIGHTER_PROTOCOL;
const LOGO = 'https://app.lighter.xyz/apple-touch-icon.png';
const NOT_FOUND = 21100;

export interface LighterAccount {
  total_asset_value?: string;
  assets?: { symbol: string; margin_balance?: string; balance?: string }[];
}

export function lighterHoldings(accounts: LighterAccount[], chain: string, fallbackSymbol: string): Holding[] {
  const holdings: Holding[] = [];
  for (const account of accounts) {
    const value = Number(account.total_asset_value);
    if (!Number.isFinite(value) || value === 0) continue;
    const funded = account.assets?.find((a) => Number(a.margin_balance) > 0 || Number(a.balance) > 0);
    holdings.push({
      chain,
      protocol: PROTOCOL,
      symbol: funded?.symbol ?? fallbackSymbol,
      quantity: value,
      price: 1,
      value,
      type: value < 0 ? 'borrow' : 'futures',
    });
  }
  return holdings;
}

async function fetchAccounts(host: string, address: string): Promise<LighterAccount[]> {
  try {
    const answer = await getJson<{ accounts?: LighterAccount[] }>(
      `${host}/api/v1/account?by=l1_address&value=${address}`,
    );
    return answer.accounts ?? [];
  } catch (err) {
    if (err instanceof HttpError && err.body.includes(String(NOT_FOUND))) return [];
    throw err;
  }
}

export async function collectLighter(address: string): Promise<CollectResult> {
  const holdings: Holding[] = [];
  for (const venue of LIGHTER_VENUES) {
    holdings.push(...lighterHoldings(await fetchAccounts(venue.host, address), venue.chain, venue.collateral));
  }
  return {
    holdings,
    warnings: [],
    logos: holdings.length > 0 ? [{ kind: 'protocol', key: PROTOCOL, url: LOGO }] : [],
  };
}
