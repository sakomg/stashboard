// Zerion API (free tier): wallet tokens and DeFi positions for EVM chains and Solana.
//
// The free key is small: about one request a second and a few hundred a day for the whole key, of which
// reads of DeFi positions may use only a quarter. So every answer is kept per wallet and reused for a while,
// DeFi positions are read less often than token balances, and the allowance Zerion reports in its response
// headers is respected before asking at all. When Zerion says no, the last answer is used and says how old it is.
import type { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import { receiptUnderlying } from '../assets.ts';
import { getJsonWithHeaders, HttpError } from '../http.ts';
import { LIGHTER_PROTOCOL } from './lighter.ts';
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

/** Zerion refused to answer because an allowance is used up; retrying now will not help. */
export class ZerionLimitError extends Error {}

/** The allowance as Zerion last reported it. Times are milliseconds since the epoch. */
export interface ZerionQuota {
  tier: string | null;
  dayLimit: number | null;
  dayRemaining: number | null;
  dayResetsAt: number | null;
  /** Reads of DeFi positions are refused until then. */
  defiBlockedUntil: number;
}

const quota: ZerionQuota = { tier: null, dayLimit: null, dayRemaining: null, dayResetsAt: null, defiBlockedUntil: 0 };
export const zerionQuota = (): ZerionQuota => ({ ...quota });

/** For tests: forget what Zerion reported. */
export function resetZerionQuota(): void {
  Object.assign(quota, { tier: null, dayLimit: null, dayRemaining: null, dayResetsAt: null, defiBlockedUntil: 0 });
}

function noteQuota(headers: Headers, now: number): void {
  const num = (name: string): number | null => {
    const value = headers.get(name);
    return value === null || !Number.isFinite(Number(value)) ? null : Number(value);
  };
  quota.tier = headers.get('ratelimit-org-tier') ?? quota.tier;
  quota.dayLimit = num('ratelimit-org-day-limit') ?? quota.dayLimit;
  quota.dayRemaining = num('ratelimit-org-day-remaining') ?? quota.dayRemaining;
  const reset = num('ratelimit-org-day-reset');
  if (reset !== null) quota.dayResetsAt = now + reset * 1000;
}

const inHours = (until: number, now: number): string => {
  const hours = Math.max(1, Math.ceil((until - now) / 3_600_000));
  return `in about ${hours} h`;
};

// Requests are spaced a little over a second apart; a refused one is retried after a growing pause.
export const zerionTiming = { minIntervalMs: 1100, retryPausesMs: [2000, 5000, 10000] };
/** Requests kept back from the daily allowance, so a manual update late in the day still works. */
const DAY_RESERVE = 5;
let lastRequestAt = 0;

export interface ZerionCall {
  /** Reads of DeFi positions count against a smaller allowance. */
  defi?: boolean;
  /** Told when a request has to wait, so the page can say why an update is slow. */
  onWait?: (note: string) => void;
}

async function zerionGet<T>(url: string, apiKey: string, call: ZerionCall = {}): Promise<T> {
  const headers = { authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}` };
  for (let attempt = 0; ; attempt++) {
    const now = Date.now();
    if (call.defi && now < quota.defiBlockedUntil) {
      throw new ZerionLimitError(
        `Zerion's allowance for DeFi positions is used up; it renews ${inHours(quota.defiBlockedUntil, now)}`,
      );
    }
    if (quota.dayRemaining !== null && quota.dayRemaining <= DAY_RESERVE && (quota.dayResetsAt ?? 0) > now) {
      throw new ZerionLimitError(`Zerion's daily allowance is used up; it renews ${inHours(quota.dayResetsAt!, now)}`);
    }
    const wait = lastRequestAt + zerionTiming.minIntervalMs - now;
    if (wait > 0) await sleep(wait);
    try {
      const answer = await getJsonWithHeaders<T>(url, headers);
      noteQuota(answer.headers, Date.now());
      return answer.data;
    } catch (err) {
      if (err instanceof HttpError) noteQuota(err.headers, Date.now());
      if (!(err instanceof HttpError) || err.status !== 429) throw err;
      // A DeFi read refused twice in a row is the DeFi allowance, not a burst: stop until the day renews.
      if (call.defi && attempt >= 1) {
        quota.defiBlockedUntil = Math.max(quota.dayResetsAt ?? 0, Date.now() + 60 * 60_000);
        throw new ZerionLimitError(
          `Zerion's allowance for DeFi positions is used up; it renews ${inHours(quota.defiBlockedUntil, Date.now())}`,
        );
      }
      const pause = zerionTiming.retryPausesMs[attempt];
      if (pause === undefined)
        throw new ZerionLimitError('Zerion kept refusing requests; it is rate limiting this key');
      call.onWait?.(`Zerion asked to slow down; trying again in ${pause / 1000} s`);
      await sleep(pause);
    } finally {
      lastRequestAt = Date.now();
    }
  }
}

export type PositionFilter = 'only_simple' | 'only_complex';

/** Positions of one wallet: plain tokens (only_simple) or positions in protocols (only_complex). */
export async function fetchPositions(
  apiKey: string,
  address: string,
  filter: PositionFilter,
  onWait?: (note: string) => void,
): Promise<ZerionPosition[]> {
  let url: string | undefined =
    `https://api.zerion.io/v1/wallets/${address}/positions/` +
    `?currency=usd&filter[positions]=${filter}&filter[trash]=only_non_trash&page[size]=100`;

  const out: ZerionPosition[] = [];
  while (url) {
    const page: ApiPage = await zerionGet<ApiPage>(url, apiKey, { defi: filter === 'only_complex', onWait });
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

/** How long an answer is reused before the wallet is asked again. */
export const REUSE_MS: Record<PositionFilter, number> = {
  // Long enough that adding a wallet, a deploy or a second click does not re-read every other wallet.
  only_simple: 10 * 60_000,
  // Positions in protocols change rarely and their reads are the scarce ones.
  only_complex: 3 * 60 * 60_000,
};

const PART_NAMES: Record<PositionFilter, string> = { only_simple: 'Token balances', only_complex: 'DeFi positions' };

interface Cached {
  at: number;
  positions: ZerionPosition[];
}

function readCache(db: DatabaseSync, address: string, part: PositionFilter): Cached | null {
  const row = db
    .prepare('SELECT fetched_at, positions FROM zerion_cache WHERE address = ? AND part = ?')
    .get(address.toLowerCase(), part) as { fetched_at: string; positions: string } | undefined;
  return row ? { at: Date.parse(row.fetched_at), positions: JSON.parse(row.positions) as ZerionPosition[] } : null;
}

function writeCache(db: DatabaseSync, address: string, part: PositionFilter, at: number, positions: ZerionPosition[]) {
  db.prepare('INSERT OR REPLACE INTO zerion_cache (address, part, fetched_at, positions) VALUES (?, ?, ?, ?)').run(
    address.toLowerCase(),
    part,
    new Date(at).toISOString(),
    JSON.stringify(positions),
  );
}

/**
 * The DeFi positions stored for this wallet by the last good collection, shaped like a Zerion answer.
 * Used once, when Zerion refuses before anything was kept: an old position beats a missing one.
 */
export function lastStoredDefi(db: DatabaseSync, address: string): Cached | null {
  const last = db
    .prepare(
      `SELECT sa.snapshot_id, sa.account_id, s.started_at
         FROM snapshot_accounts sa
         JOIN snapshots s ON s.id = sa.snapshot_id
         JOIN accounts a ON a.id = sa.account_id
        WHERE lower(a.address) = ? AND sa.status = 'ok'
        ORDER BY sa.snapshot_id DESC LIMIT 1`,
    )
    .get(address.toLowerCase()) as { snapshot_id: number; account_id: number; started_at: string } | undefined;
  if (!last) return null;
  const rows = db
    .prepare(
      `SELECT chain, protocol, symbol, type, quantity, price, value_usd AS value, read_at AS readAt
         FROM holdings
        WHERE snapshot_id = ? AND account_id = ? AND protocol IS NOT NULL AND protocol <> ?`,
    )
    .all(last.snapshot_id, last.account_id, LIGHTER_PROTOCOL) as unknown as (Holding & { readAt: string | null })[];
  if (rows.length === 0) return null;
  const at = Math.min(...rows.map((r) => Date.parse(r.readAt ?? last.started_at)));
  return {
    at,
    positions: rows.map((r) => ({
      chain: r.chain,
      type: r.type === 'borrow' ? 'loan' : r.type,
      protocol: r.protocol,
      symbol: r.symbol,
      quantity: r.quantity,
      price: r.price,
      value: Math.abs(r.value),
      icon: null,
      protocolIcon: null,
    })),
  };
}

const ago = (ms: number): string =>
  ms < 90 * 60_000 ? `${Math.max(1, Math.round(ms / 60_000))} min` : `${Math.round(ms / 3_600_000)} h`;

export interface ZerionOptions {
  now?: number;
  onWait?: (note: string) => void;
}

export async function collectZerion(
  db: DatabaseSync,
  apiKey: string,
  address: string,
  kind: 'evm' | 'solana',
  { now = Date.now(), onWait }: ZerionOptions = {},
): Promise<CollectResult> {
  // Zerion reports only plain tokens and staking for Solana, so there is nothing more to ask for there.
  const parts: PositionFilter[] = kind === 'evm' ? ['only_simple', 'only_complex'] : ['only_simple'];
  const warnings: string[] = [];
  const read: { positions: ZerionPosition[]; readAt: string | null }[] = [];

  for (const part of parts) {
    const cached = readCache(db, address, part);
    if (cached && now - cached.at < REUSE_MS[part]) {
      read.push({ positions: cached.positions, readAt: new Date(cached.at).toISOString() });
      continue;
    }
    try {
      const positions = await fetchPositions(apiKey, address, part, onWait);
      writeCache(db, address, part, Date.now(), positions);
      read.push({ positions, readAt: null });
    } catch (err) {
      if (!(err instanceof ZerionLimitError)) throw err;
      const earlier = cached ?? (part === 'only_complex' ? lastStoredDefi(db, address) : null);
      if (earlier) {
        warnings.push(`${PART_NAMES[part]} are from ${ago(now - earlier.at)} ago. ${err.message}.`);
        read.push({ positions: earlier.positions, readAt: new Date(earlier.at).toISOString() });
      } else if (part === 'only_complex') {
        // Token balances alone still give most of the picture; say plainly what is missing.
        warnings.push(`DeFi positions could not be read yet and are left out. ${err.message}.`);
      } else {
        throw err;
      }
    }
  }

  const readAtOf = new Map<ZerionPosition, string | null>();
  for (const r of read) for (const p of r.positions) readAtOf.set(p, r.readAt);
  const positions = withoutDepositReceipts(read.flatMap((r) => r.positions));

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
      readAt: readAtOf.get(p) ?? null,
    });
  }
  if (unpriced > 0) warnings.push(`${unpriced} tokens without a price skipped`);
  return { holdings, logos, warnings };
}

/** Names and logos of every chain Zerion knows. */
export async function fetchChains(apiKey: string): Promise<LogoHint[]> {
  const page = await zerionGet<{
    data: { id: string; attributes: { name?: string; icon?: { url?: string } | null } }[];
  }>('https://api.zerion.io/v1/chains/', apiKey);
  return page.data.flatMap((c) =>
    c.attributes.icon?.url
      ? [{ kind: 'chain' as const, key: c.id, url: c.attributes.icon.url, name: c.attributes.name }]
      : [],
  );
}
