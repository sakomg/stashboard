import type { DatabaseSync } from 'node:sqlite';
import type { Asset } from '../domain/assets.ts';
import { buildPortfolio } from '../domain/portfolio.ts';
import { boardMembers, currentState } from '../storage/index.ts';
import { EXCHANGES, isExchange } from './exchanges.ts';
import { logoIndex } from './logos.ts';
import { historyView, portfolioView } from './view.ts';

export const BOARD_MINIMUM = 3;
const LARGEST = 5;

type ResolveFor = (userId: number) => (symbol: string) => Asset;

interface Entry {
  id: number;
  key: string;
  name: string;
  onBoard: boolean;
  you: boolean;
  netWorth: number;
  wallets: number;
  exchanges: number;
  holdings: string[];
}

const cents = (n: number): number => Math.round(n * 100) / 100;

function standings(db: DatabaseSync, userId: number, resolveFor: ResolveFor) {
  const members = boardMembers(db);
  const admin = members.find((m) => m.id === userId)?.admin ?? false;
  const entries: Entry[] = [];
  for (const member of members) {
    if (!member.onBoard && member.id !== userId) continue;
    const states = currentState(db, member.id);
    if (states.length === 0) continue;
    const exchanges = states.filter((s) => isExchange(s.account.kind)).length;
    const portfolio = buildPortfolio(states, resolveFor(member.id));
    entries.push({
      id: member.id,
      key: member.key,
      name: admin ? member.person : member.name,
      onBoard: member.onBoard,
      you: member.id === userId,
      netWorth: cents(portfolio.netWorth),
      wallets: states.length - exchanges,
      exchanges,
      holdings: portfolio.assets
        .filter((a) => a.value > 0)
        .slice(0, LARGEST)
        .map((a) => a.key),
    });
  }
  const ranked = entries
    .filter((e) => e.onBoard)
    .sort((a, b) => b.netWorth - a.netWorth || a.name.localeCompare(b.name));
  const onBoard = members.find((m) => m.id === userId)?.onBoard ?? false;
  return {
    onBoard,
    open: onBoard && ranked.length >= BOARD_MINIMUM,
    ranked,
    own: entries.find((e) => e.you) ?? null,
  };
}

const row = ({ key, name, you, netWorth, wallets, exchanges, holdings }: Entry) => ({
  key,
  name,
  you,
  netWorth,
  wallets,
  exchanges,
  holdings,
});

export function boardView(db: DatabaseSync, userId: number, resolveFor: ResolveFor) {
  const { onBoard, open, ranked, own } = standings(db, userId, resolveFor);
  const rows = (open ? ranked : own ? [own] : []).map(row);
  return {
    onBoard,
    open,
    portfolios: ranked.length,
    others: ranked.filter((e) => !e.you).length,
    minimum: BOARD_MINIMUM,
    rows,
    logos: logoIndex(db, new Set(rows.flatMap((r) => r.holdings.map((key) => `token/${key}`)))).available,
  };
}

function find(db: DatabaseSync, userId: number, key: string, resolveFor: ResolveFor) {
  const { open, ranked, own } = standings(db, userId, resolveFor);
  const entry = own?.key === key ? own : open ? ranked.find((e) => e.key === key) : undefined;
  if (!entry) return null;
  const place = open ? ranked.indexOf(entry) : -1;
  return { entry, rank: place < 0 ? null : place + 1, portfolios: ranked.length };
}

const WALLETS: Record<string, string> = { evm: 'EVM wallet', solana: 'Solana wallet', ton: 'TON wallet' };

export function boardPortfolio(db: DatabaseSync, userId: number, key: string, resolveFor: ResolveFor) {
  const found = find(db, userId, key, resolveFor);
  if (!found) return null;
  const view = portfolioView(db, found.entry.id, resolveFor(found.entry.id));
  const nameOf = (kind: string): string => (isExchange(kind) ? EXCHANGES[kind] : (WALLETS[kind] ?? 'Wallet'));
  const total = new Map<string, number>();
  for (const s of view.sources) total.set(nameOf(s.kind), (total.get(nameOf(s.kind)) ?? 0) + 1);
  const seen = new Map<string, number>();
  const accounts = new Map(
    view.sources.map((s, i) => {
      const name = nameOf(s.kind);
      const n = (seen.get(name) ?? 0) + 1;
      seen.set(name, n);
      return [s.id, { id: -(i + 1), label: total.get(name)! > 1 ? `${name} ${n}` : name }];
    }),
  );
  return {
    ...view,
    board: { name: found.entry.name, rank: found.rank, portfolios: found.portfolios, you: found.entry.you },
    assets: view.assets.map((a) => ({ ...a, signal: a.signal && { ...a.signal, dismissed: true } })),
    sources: view.sources.map((s) => ({ ...s, ...accounts.get(s.id)!, address: '', error: null, warnings: [] })),
    holdings: view.holdings.map(({ accountId, ...h }) => {
      const account = accounts.get(accountId)!;
      return { ...h, accountId: account.id, account: account.label };
    }),
  };
}

export function boardHistory(
  db: DatabaseSync,
  userId: number,
  key: string,
  resolveFor: ResolveFor,
  days: number | null,
) {
  const found = find(db, userId, key, resolveFor);
  return found ? historyView(db, found.entry.id, resolveFor(found.entry.id), days) : null;
}
