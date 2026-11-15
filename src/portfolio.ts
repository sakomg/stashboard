// Turns per-account holdings into the merged portfolio the console and the dashboard show.
import type { Asset } from './assets.ts';
import type { AccountState } from './db.ts';

export interface AssetRow extends Asset {
  /** Sum over all wrappers; for merged assets (ETH + wstETH) it is an approximation. */
  quantity: number;
  /** Price of the canonical symbol when held directly, otherwise value / quantity. */
  price: number | null;
  value: number;
  /** Share of net worth, 0–1. */
  share: number;
}

export interface Portfolio {
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
