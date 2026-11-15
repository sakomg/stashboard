// Merges the same asset held in different wrappers and places into one canonical asset.
// The rules live in assets.json at the project root and are meant to be edited.
import { readFileSync } from 'node:fs';

export interface AssetRules {
  /** Canonical symbol → wrappers and receipts that count as the same asset. */
  aliases: Record<string, string[]>;
  /** Category → canonical symbols. */
  categories: Record<string, string[]>;
  /** Stock tickers; tokenized wrappers are recognised by suffix (NVDAx, NVDAB, NVDAon). */
  stocks: string[];
}

export interface Asset {
  key: string;
  category: string;
  /** Set when the category does not come from assets.json: chosen by hand, or looked up. */
  source?: 'manual' | 'auto';
}

/** Categories from outside assets.json, by canonical symbol. */
export interface Learned {
  manual: Map<string, string>;
  auto: Map<string, string>;
}

export const STOCKS_CATEGORY = 'Stocks';
export const OTHER_CATEGORY = 'Other';

// Aave names a deposit receipt after the market and the token inside it: aEthWETH, aArbUSDC, aBaswstETH.
const AAVE_RECEIPT =
  /^a(?:Eth|Arb|Opt|Bas|Pol|Ava|Gno|Bnb|Scr|Lin|Met|ZkS|Zks|Son|Cel|Ink|Pla|Man|Sei)(?:Lido|EtherFi|Horizon)?(.{2,})$/;

/** The token inside a lending receipt (WETH for aEthWETH), or null when the symbol is not a receipt. */
export const receiptUnderlying = (symbol: string): string | null => AAVE_RECEIPT.exec(symbol)?.[1] ?? null;

/**
 * A category chosen by hand wins, then assets.json, then one that was looked up; the rest is "Other".
 * `learned` is read on every call, so it can be refilled while the resolver is in use.
 */
export function createResolver(rules: AssetRules, learned?: Learned): (symbol: string) => Asset {
  const alias = new Map<string, string>();
  for (const [key, wrappers] of Object.entries(rules.aliases)) {
    for (const w of wrappers) alias.set(w, key);
  }
  const category = new Map<string, string>();
  for (const [name, symbols] of Object.entries(rules.categories)) {
    for (const s of symbols) category.set(s, name);
  }
  const stocks = new Set(rules.stocks);

  const placed = (key: string, fromRules: string | undefined): Asset => {
    const manual = learned?.manual.get(key);
    if (manual) return { key, category: manual, source: 'manual' };
    if (fromRules) return { key, category: fromRules };
    const auto = learned?.auto.get(key);
    return auto ? { key, category: auto, source: 'auto' } : { key, category: OTHER_CATEGORY };
  };

  return (held) => {
    // A lending receipt is the token that was lent.
    const symbol = receiptUnderlying(held) ?? held;
    const stock = /^([A-Z]+?)(x|B|on)?$/.exec(symbol);
    if (stock && stocks.has(stock[1]!)) return placed(stock[1]!, STOCKS_CATEGORY);
    // Exact spelling first: wrappers differ by case (stETH, cbBTC), plain tickers do not.
    const key = alias.get(symbol) ?? alias.get(symbol.toUpperCase()) ?? symbol;
    return placed(key, category.get(key) ?? category.get(key.toUpperCase()));
  };
}

export function loadAssetRules(path: string | URL = new URL('../assets.json', import.meta.url)): AssetRules {
  return JSON.parse(readFileSync(path, 'utf8')) as AssetRules;
}
