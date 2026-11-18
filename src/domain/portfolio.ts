import type { Asset } from './assets.ts';
import type { AccountState } from './types.ts';

interface AssetRow extends Asset {
  quantity: number;
  price: number | null;
  value: number;
  share: number;
}

interface Portfolio {
  netWorth: number;
  assets: AssetRow[];
}

export function buildPortfolio(states: AccountState[], resolve: (symbol: string) => Asset): Portfolio {
  const rows = new Map<string, AssetRow>();
  let netWorth = 0;
  for (const { holdings } of states) {
    for (const h of holdings) {
      const asset = resolve(h.symbol);
      let row = rows.get(asset.key);
      if (!row) rows.set(asset.key, (row = { ...asset, quantity: 0, price: null, value: 0, share: 0 }));
      row.quantity += h.quantity;
      row.value += h.value;
      if (h.symbol === asset.key && h.price !== null) row.price = h.price;
      netWorth += h.value;
    }
  }
  const assets = [...rows.values()].sort((a, b) => b.value - a.value);
  for (const row of assets) {
    row.price ??= row.quantity !== 0 ? row.value / row.quantity : null;
    row.share = netWorth !== 0 ? row.value / netWorth : 0;
  }
  return { netWorth, assets };
}

interface Estimate {
  change: number;
  coverage: number;
}

const MIN_COVERAGE = 0.5;

interface AccountChange {
  now: number;
  then: number | null;
}

export function historyChange(accounts: AccountChange[]): number | null {
  let now = 0;
  let then = 0;
  let covered = 0;
  let total = 0;
  for (const a of accounts) {
    total += Math.abs(a.now);
    if (a.then === null) continue;
    covered += Math.abs(a.now);
    now += a.now;
    then += a.then;
  }
  if (then === 0 || (total > 0 && covered / total < MIN_COVERAGE)) return null;
  return now / then - 1;
}

interface AccountHistory {
  value: number;
  since: string | null;
}

export function coveredSince(accounts: AccountHistory[]): string | null {
  const total = accounts.reduce((sum, a) => sum + Math.abs(a.value), 0);
  const read = accounts
    .filter((a): a is AccountHistory & { since: string } => a.since !== null)
    .sort((a, b) => a.since.localeCompare(b.since));
  let covered = 0;
  for (const a of read) {
    covered += Math.abs(a.value);
    if (covered >= total * MIN_COVERAGE) return a.since;
  }
  return null;
}

export function estimateChange(
  assets: Pick<AssetRow, 'key' | 'category' | 'value'>[],
  changeOf: (asset: string) => number | null | undefined,
  flat: (category: string) => boolean,
): Estimate | null {
  let now = 0;
  let then = 0;
  let covered = 0;
  let total = 0;
  for (const a of assets) {
    total += Math.abs(a.value);
    const change = flat(a.category) ? 0 : changeOf(a.key);
    if (change == null || change <= -1) continue;
    covered += Math.abs(a.value);
    now += a.value;
    then += a.value / (1 + change);
  }
  if (total === 0 || covered / total < MIN_COVERAGE || then <= 0) return null;
  return { change: now / then - 1, coverage: covered / total };
}
