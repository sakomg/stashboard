export type HoldingType =
  'wallet' | 'earn' | 'staked' | 'deposit' | 'borrow' | 'lp' | 'futures' | 'margin' | 'locked' | 'reward';

/** One position as a source reports it, before assets are merged. */
export interface Holding {
  /** Chain id, or the exchange name for exchange balances. */
  chain: string;
  /** DeFi protocol or exchange wallet (Spot, Earn, ...); null for plain wallet balances. */
  protocol: string | null;
  symbol: string;
  quantity: number;
  price: number | null;
  /** USD. Negative for debts, so that sums are net worth. */
  value: number;
  type: HoldingType;
}

export type LogoKind = 'token' | 'chain' | 'protocol';

export interface LogoHint {
  kind: LogoKind;
  /** Token symbol as the source spells it, chain id, or protocol name. */
  key: string;
  url: string;
  /** Display name, for chains. */
  name?: string;
}

export interface CollectResult {
  holdings: Holding[];
  /** Non-fatal problems: an unpriced asset, a sub-wallet that could not be read. */
  warnings: string[];
  /** Logos the source offers for what it returned; fetched later, once, and served from this server. */
  logos?: LogoHint[];
  /** Total as the source itself reports it, when available. Used to cross-check our sum. */
  reportedTotal?: number;
}
