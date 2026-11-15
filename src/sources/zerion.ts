// Zerion API (free tier): wallet tokens and DeFi positions for EVM chains and Solana.
import { setTimeout as sleep } from 'node:timers/promises';
import { receiptUnderlying } from '../assets.ts';
import { getJson, HttpError } from '../http.ts';
import type { CollectResult, Holding, HoldingType, LogoHint } from '../types.ts';

export interface ZerionPosition {
  chain: string;
  /** wallet | deposit | loan | staked | locked | reward | ... */
  type: string;
  protocol: string | null;
  symbol: string;
  quantity: number;
  price: number | null;
  icon: string | null;
  protocolIcon: string | null;
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
      fungible_info?: { symbol?: string; icon?: { url?: string } | null };
      application_metadata?: { icon?: { url?: string } | null } | null;
    };
    relationships?: { chain?: { data?: { id?: string } } };
  }[];
}

// The free tier allows about one request per second per key and still throttles short bursts,
// so requests are spaced out and a throttled one is retried with a growing pause.
const MIN_INTERVAL_MS = 1500;
const RETRY_PAUSES_MS = [3000, 6000, 12000];
let lastRequestAt = 0;

async function zerionGet<T>(url: string, headers: Record<string, string>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await getJson<T>(url, headers);
    } catch (err) {
      const pause = RETRY_PAUSES_MS[attempt];
      if (!(err instanceof HttpError) || err.status !== 429 || pause === undefined) throw err;
      await sleep(pause);
    } finally {
      lastRequestAt = Date.now();
    }
  }
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
    const page: ApiPage = await zerionGet<ApiPage>(url, headers);
    for (const { attributes: a, relationships } of page.data) {
      out.push({
        chain: relationships?.chain?.data?.id ?? 'unknown',
        type: a.position_type,
        protocol: a.protocol ?? null,
        symbol: a.fungible_info?.symbol ?? '?',
        icon: a.fungible_info?.icon?.url ?? null,
        protocolIcon: a.application_metadata?.icon?.url ?? null,
        quantity: a.quantity.float,
        price: a.price ?? null,
        value: a.value ?? null,
      });
    }
    url = page.links?.next;
  }
  return out;
}

const TYPES: Record<string, HoldingType> = {
  wallet: 'wallet',
  deposit: 'deposit',
  loan: 'borrow',
  staked: 'staked',
  locked: 'locked',
  reward: 'reward',
  airdrop: 'reward',
  margin: 'margin',
};

/**
 * A lending deposit shows up twice: as the position in the protocol and as the receipt token the protocol
 * handed out (aEthWETH for WETH lent on Aave). They are the same money, so the receipt is dropped when the
 * deposit it stands for is listed on the same chain. A receipt with no listed deposit is kept.
 */
export function withoutDepositReceipts(positions: ZerionPosition[]): ZerionPosition[] {
  const deposited = new Set(
    positions.filter((p) => p.type === 'deposit').map((p) => `${p.chain}\n${p.symbol.toLowerCase()}`),
  );
  return positions.filter((p) => {
    const inside = p.type === 'wallet' ? receiptUnderlying(p.symbol) : null;
    return !(inside && deposited.has(`${p.chain}\n${inside.toLowerCase()}`));
  });
}

export async function collectZerion(apiKey: string, address: string, kind: 'evm' | 'solana'): Promise<CollectResult> {
  const positions = withoutDepositReceipts(await fetchPositions(apiKey, address, kind));
  const holdings: Holding[] = [];
  const logos: LogoHint[] = [];
  let unpriced = 0;
  for (const p of positions) {
    // Tokens Zerion cannot price are almost always airdropped spam, so they are counted but not listed.
    if (!p.value) {
      unpriced++;
      continue;
    }
    const type = TYPES[p.type] ?? 'wallet';
    if (p.icon) logos.push({ kind: 'token', key: p.symbol, url: p.icon });
    if (p.protocol && p.protocolIcon) logos.push({ kind: 'protocol', key: p.protocol, url: p.protocolIcon });
    holdings.push({
      chain: p.chain,
      protocol: p.protocol,
      symbol: p.symbol,
      quantity: p.quantity,
      price: p.price,
      value: type === 'borrow' ? -Math.abs(p.value) : p.value,
      type,
    });
  }
  return { holdings, logos, warnings: unpriced > 0 ? [`${unpriced} tokens without a price skipped`] : [] };
}

/** Names and logos of every chain Zerion knows. */
export async function fetchChains(apiKey: string): Promise<LogoHint[]> {
  const headers = { authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}` };
  const page = await zerionGet<{
    data: { id: string; attributes: { name?: string; icon?: { url?: string } | null } }[];
  }>('https://api.zerion.io/v1/chains/', headers);
  return page.data.flatMap((c) =>
    c.attributes.icon?.url
      ? [{ kind: 'chain' as const, key: c.id, url: c.attributes.icon.url, name: c.attributes.name }]
      : [],
  );
}
