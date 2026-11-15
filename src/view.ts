// Shapes stored data into what the dashboard needs: the current portfolio and its history.
import type { DatabaseSync } from 'node:sqlite';
import type { Asset } from './assets.ts';
import { currentState, listSnapshots, snapshotAt, snapshotValues } from './db.ts';
import { buildPortfolio } from './portfolio.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const short = (a: string): string => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const ratio = (now: number, then: number | undefined): number | null =>
  then === undefined || then === 0 ? null : now / then - 1;

export function portfolioView(db: DatabaseSync, resolve: (symbol: string) => Asset, now = new Date()) {
  const states = currentState(db);
  const portfolio = buildPortfolio(states, resolve);

  // The portfolio as it stood a day, a week and a month ago; null until history reaches that far back.
  const past = (days: number) => {
    const snapshot = snapshotAt(db, new Date(now.getTime() - days * DAY_MS));
    return snapshot ? buildPortfolio(currentState(db, snapshot.id), resolve) : null;
  };
  const [d1, d7, d30] = [past(1), past(7), past(30)];
  const priceThen = (p: typeof d1, key: string): number | undefined =>
    p?.assets.find((a) => a.key === key)?.price ?? undefined;

  return {
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
    })),
    sources: states.map((s) => ({
      id: s.account.id,
      kind: s.account.kind,
      label: s.account.label,
      // Full addresses stay on the server; the label identifies the wallet.
      address: short(s.account.address),
      status: s.lastStatus,
      stale: s.stale,
      error: s.lastError,
      collectedAt: s.collectedAt,
      warnings: s.warnings,
      value: s.holdings.reduce((sum, h) => sum + h.value, 0),
    })),
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

/**
 * Value by category at every snapshot. An account that failed in a snapshot keeps its previous
 * value, so one source being down does not show as a drop in net worth.
 */
export function historyView(
  db: DatabaseSync,
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
    if (!time) return; // unfinished snapshot
    const categories: Record<string, number> = {};
    for (const perAccount of latest.values()) {
      for (const [name, value] of Object.entries(perAccount)) categories[name] = (categories[name] ?? 0) + value;
    }
    points.push({ time, total: Object.values(categories).reduce((s, v) => s + v, 0), categories });
  };

  for (const row of snapshotValues(db)) {
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
  // Thin out evenly, always keeping the most recent point.
  const step = inRange.length / MAX_POINTS;
  const thinned = Array.from({ length: MAX_POINTS - 1 }, (_, i) => inRange[Math.floor(i * step)]!);
  thinned.push(inRange.at(-1)!);
  return thinned;
}
