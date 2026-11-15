import { readFileSync } from 'node:fs';

export interface AssetRules {
  aliases: Record<string, string[]>;
  categories: Record<string, string[]>;
  stocks: string[];
}

export interface Asset {
  key: string;
  category: string;
  source?: 'manual' | 'auto';
}

export interface Learned {
  manual: Map<string, string>;
  auto: Map<string, string>;
}

export const STOCKS_CATEGORY = 'Stocks';
export const OTHER_CATEGORY = 'Other';

const AAVE_RECEIPT =
  /^a(?:Eth|Arb|Opt|Bas|Pol|Ava|Gno|Bnb|Scr|Lin|Met|ZkS|Zks|Son|Cel|Ink|Pla|Man|Sei)(?:Lido|EtherFi|Horizon)?(.{2,})$/;

export const receiptUnderlying = (symbol: string): string | null => AAVE_RECEIPT.exec(symbol)?.[1] ?? null;

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
    const symbol = receiptUnderlying(held) ?? held;
    const stock = /^([A-Z]+?)(x|B|on)?$/.exec(symbol);
    if (stock && stocks.has(stock[1]!)) return placed(stock[1]!, STOCKS_CATEGORY);
    const key = alias.get(symbol) ?? alias.get(symbol.toUpperCase()) ?? symbol;
    return placed(key, category.get(key) ?? category.get(key.toUpperCase()));
  };
}

export function loadAssetRules(path: string | URL = new URL('../../assets.json', import.meta.url)): AssetRules {
  return JSON.parse(readFileSync(path, 'utf8')) as AssetRules;
}
