import type { WalletKind } from './address.ts';
import type { ExchangeKind } from './exchange.ts';

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

export type LogoKind = 'token' | 'chain' | 'protocol' | 'exchange';

export interface LogoHint {
  kind: LogoKind;
  key: string;
  url: string;
  name?: string;
}

export interface ContractHint {
  symbol: string;
  chain: string;
  address: string;
}

export interface CollectResult {
  holdings: Holding[];
  warnings: string[];
  logos?: LogoHint[];
  contracts?: ContractHint[];
  reportedTotal?: number;
}

export type AccountKind = WalletKind | ExchangeKind;

export interface Account {
  id: number;
  kind: AccountKind;
  label: string;
  address: string;
}

export interface Wallet extends Account {
  kind: WalletKind;
}

export interface AccountState {
  account: Account;
  lastStatus: 'ok' | 'error' | null;
  lastError: string | null;
  collectedAt: string | null;
  stale: boolean;
  warnings: string[];
  reportedTotal: number | null;
  holdings: Holding[];
}
