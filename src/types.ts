export type HoldingType =
  'wallet' | 'earn' | 'staked' | 'deposit' | 'borrow' | 'lp' | 'futures' | 'margin' | 'locked' | 'reward';

export interface Holding {
  chain: string;
  protocol: string | null;
  symbol: string;
  quantity: number;
  price: number | null;
  value: number;
  type: HoldingType;
  readAt?: string | null;
}

export type LogoKind = 'token' | 'chain' | 'protocol';

export interface LogoHint {
  kind: LogoKind;
  key: string;
  url: string;
  name?: string;
}

export interface CollectResult {
  holdings: Holding[];
  warnings: string[];
  logos?: LogoHint[];
  reportedTotal?: number;
}
