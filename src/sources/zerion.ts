// Zerion API (free tier): wallet tokens and DeFi positions for EVM chains and Solana.
import { setTimeout as sleep } from 'node:timers/promises';
import { getJson } from '../http.ts';

export interface ZerionPosition {
  chain: string;
  /** wallet | deposit | loan | staked | locked | reward | ... */
  type: string;
  protocol: string | null;
  symbol: string;
  quantity: number;
  price: number | null;
  /** USD; null when Zerion has no price for the token. */
  value: number | null;
}

interface ApiPage {
  links?: { next?: string };
  data: {
    attributes: {
      position_type: string;
      protocol?: string | null;
      quantity: { float: number };
      price?: number | null;
      value?: number | null;
      fungible_info?: { symbol?: string };
    };
    relationships?: { chain?: { data?: { id?: string } } };
  }[];
}

// The free tier allows one request per second per key.
const MIN_INTERVAL_MS = 1100;
let lastRequestAt = 0;

async function throttle(): Promise<void> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

/** All positions of one wallet. DeFi positions are included for EVM; Zerion returns only plain tokens and staking for Solana. */
export async function fetchPositions(
  apiKey: string,
  address: string,
  kind: 'evm' | 'solana',
): Promise<ZerionPosition[]> {
  const headers = { authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}` };
  const filter = kind === 'evm' ? 'no_filter' : 'only_simple';
  let url: string | undefined =
    `https://api.zerion.io/v1/wallets/${address}/positions/` +
    `?currency=usd&filter[positions]=${filter}&filter[trash]=only_non_trash&page[size]=100`;

  const out: ZerionPosition[] = [];
  while (url) {
    await throttle();
    const page: ApiPage = await getJson<ApiPage>(url, headers);
    for (const { attributes: a, relationships } of page.data) {
      out.push({
        chain: relationships?.chain?.data?.id ?? 'unknown',
        type: a.position_type,
        protocol: a.protocol ?? null,
        symbol: a.fungible_info?.symbol ?? '?',
        quantity: a.quantity.float,
        price: a.price ?? null,
        value: a.value ?? null,
      });
    }
    url = page.links?.next;
  }
  return out;
}
