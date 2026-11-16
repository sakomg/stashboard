import type { DatabaseSync } from 'node:sqlite';
import type { Asset } from '../domain/assets.ts';
import {
  currentState,
  historySince,
  latestSignals,
  listSnapshots,
  snapshotAt,
  snapshotValues,
  type AccountState,
} from '../storage/index.ts';
import { exchangeHints } from './exchanges.ts';
import { STOCKS_CATEGORY } from '../domain/assets.ts';
import { logoIndex, type Wanted } from './logos.ts';
import { buildPortfolio } from '../domain/portfolio.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const short = (a: string): string => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const ratio = (now: number, then: number | undefined): number | null =>
  then === undefined || then === 0 ? null : now / then - 1;

export function portfolioView(db: DatabaseSync, userId: number, resolve: (symbol: string) => Asset, now = new Date()) {
  const states = currentState(db, userId);
  const portfolio = buildPortfolio(states, resolve);

  const past = (days: number) => {
    const snapshot = snapshotAt(db, new Date(now.getTime() - days * DAY_MS));
    return snapshot ? buildPortfolio(currentState(db, userId, snapshot.id), resolve) : null;
  };
  const [d1, d7, d30] = [past(1), past(7), past(30)];
  const priceThen = (p: typeof d1, key: string): number | undefined =>
    p?.assets.find((a) => a.key === key)?.price ?? undefined;

  const signals = new Map(latestSignals(db).map((s) => [s.asset, s]));
  const hints = exchangeHints(db);

  return {
    logos: logoIndex(db, new Set(wantedLogos(states, resolve).map((w) => `${w.kind}/${w.key}`))),
    historySince: historySince(db, userId),
    updatedAt: states.reduce<string | null>(
      (max, s) => (s.collectedAt && (!max || s.collectedAt > max) ? s.collectedAt : max),
      null,
    ),
    netWorth: portfolio.netWorth,
    changes: {
      d1: ratio(portfolio.netWorth, d1?.netWorth),
      d7: ratio(portfolio.netWorth, d7?.netWorth),
      d30: ratio(portfolio.netWorth, d30?.netWorth),
    },
    assets: portfolio.assets.map((a) => ({
      ...a,
      change1d: a.price === null ? null : ratio(a.price, priceThen(d1, a.key)),
      change7d: a.price === null ? null : ratio(a.price, priceThen(d7, a.key)),
      signal: signals.get(a.key) ?? null,
    })),
    sources: states
      .map((s) => ({
        id: s.account.id,
        kind: s.account.kind,
        label: s.account.label,
        address: s.account.kind === 'binance' ? `API key ${hints.get(s.account.id) ?? ''}` : short(s.account.address),
        status: s.lastStatus,
        stale: s.stale,
        error: s.lastError,
        collectedAt: s.collectedAt,
        warnings: s.warnings,
        value: s.holdings.reduce((sum, h) => sum + h.value, 0),
        oldestRead: s.holdings.reduce<string | null>(
          (min, h) => (h.readAt && (!min || h.readAt < min) ? h.readAt : min),
          s.collectedAt,
        ),
      }))
      .sort((a, b) => b.value - a.value),
    holdings: states.flatMap((s) =>
      s.holdings.map((h) => {
        const asset = resolve(h.symbol);
        return {
          ...h,
          accountId: s.account.id,
          account: s.account.label,
          kind: s.account.kind,
          asset: asset.key,
          category: asset.category,
        };
      }),
    ),
  };
}

export interface HistoryPoint {
  time: string;
  total: number;
  categories: Record<string, number>;
}

const MAX_POINTS = 240;

export function historyView(
  db: DatabaseSync,
  userId: number,
  resolve: (symbol: string) => Asset,
  days: number | null,
  now = new Date(),
): HistoryPoint[] {
  const times = new Map(listSnapshots(db).map((s) => [s.id, s.startedAt]));
  const latest = new Map<number, Record<string, number>>();
  const points: HistoryPoint[] = [];

  let currentId: number | undefined;
  let pending = new Map<number, Record<string, number>>();
  const flush = (): void => {
    if (currentId === undefined) return;
    for (const [account, categories] of pending) latest.set(account, categories);
    const time = times.get(currentId);
    if (!time) return;
    const categories: Record<string, number> = {};
    for (const perAccount of latest.values()) {
      for (const [name, value] of Object.entries(perAccount)) categories[name] = (categories[name] ?? 0) + value;
    }
    points.push({ time, total: Object.values(categories).reduce((s, v) => s + v, 0), categories });
  };

  for (const row of snapshotValues(db, userId)) {
    if (row.snapshotId !== currentId) {
      flush();
      currentId = row.snapshotId;
      pending = new Map();
    }
    if (row.status !== 'ok') continue;
    let categories = pending.get(row.accountId);
    if (!categories) pending.set(row.accountId, (categories = {}));
    if (row.symbol !== null && row.value !== null) {
      const { category } = resolve(row.symbol);
      categories[category] = (categories[category] ?? 0) + row.value;
    }
  }
  flush();

  const since = days === null ? '' : new Date(now.getTime() - days * DAY_MS).toISOString();
  const inRange = points.filter((p) => p.time >= since);
  if (inRange.length <= MAX_POINTS) return inRange;
  const step = inRange.length / MAX_POINTS;
  const thinned = Array.from({ length: MAX_POINTS - 1 }, (_, i) => inRange[Math.floor(i * step)]!);
  thinned.push(inRange.at(-1)!);
  return thinned;
}

export const NATIVE_TOKENS = ['BNB', 'ETH', 'SOL', 'TON'];

export function wantedLogos(states: AccountState[], resolve: (symbol: string) => Asset): Wanted[] {
  const tokens = new Map<string, { category: string; symbols: Set<string> }>();
  const chains = new Set<string>();
  const protocols = new Set<string>();
  for (const key of NATIVE_TOKENS) tokens.set(key, { category: resolve(key).category, symbols: new Set() });

  for (const { account, holdings } of states) {
    for (const h of holdings) {
      const asset = resolve(h.symbol);
      let entry = tokens.get(asset.key);
      if (!entry) tokens.set(asset.key, (entry = { category: asset.category, symbols: new Set() }));
      if (h.symbol !== asset.key) entry.symbols.add(h.symbol);
      if (account.kind !== 'binance') {
        chains.add(h.chain);
        if (h.protocol) protocols.add(h.protocol);
      }
    }
  }

  return [
    ...[...tokens].map(([key, { category, symbols }]) => ({
      kind: 'token' as const,
      key,
      alternatives: [...symbols],
      lookup: category === STOCKS_CATEGORY ? [`${key}x`, key] : [key],
    })),
    ...[...chains].map((key) => ({ kind: 'chain' as const, key })),
    ...[...protocols].map((key) => ({ kind: 'protocol' as const, key })),
  ];
}
