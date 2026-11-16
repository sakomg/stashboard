import type { FastifyBaseLogger } from 'fastify';
import { fetchMissingCategories, loadLearned } from '../services/categories.ts';
import { runCollection, updateGate, type ProgressEvent, type UpdateGate } from '../services/collector.ts';
import { fetchMissingLogos, noteLogos } from '../services/logos.ts';
import { runSignals } from '../services/signals.ts';
import { wantedLogos } from '../services/view.ts';
import { fetchChains, zerionDayUsedUp, zerionQuota } from '../sources/zerion.ts';
import { currentState, getSetting, latestSignals, listSnapshots, listWallets, setSetting } from '../storage/index.ts';
import type { Context } from './context.ts';

export interface Progress {
  phase: 'accounts' | 'signals';
  accounts: { id: number; state: 'waiting' | 'reading' | 'done' | 'failed'; note: string | null }[];
}

export interface Collection {
  readonly running: boolean;
  readonly progress: Progress | null;
  readonly intervalMs: number;
  collect(): Promise<void>;
  collectAfterCurrent(): void;
  gate(): UpdateGate;
  start(): void;
}

export function createCollection(ctx: Context, log: FastifyBaseLogger): Collection {
  const { db, config } = ctx;
  const intervalMs = Math.max(config.schedule.balancesMinutes, 5) * 60_000;
  let collecting: Promise<void> | null = null;
  let progress: Progress | null = null;
  let lastFinishedAt = 0;

  const track = (event: ProgressEvent): void => {
    if (event.type === 'start') {
      progress = {
        phase: 'accounts',
        accounts: event.accounts.map((a) => ({ id: a.id, state: 'waiting', note: null })),
      };
      return;
    }
    const entry = progress?.accounts.find((a) => a.id === event.accountId);
    if (!entry) return;
    if (event.type === 'reading') Object.assign(entry, { state: 'reading', note: null });
    else if (event.type === 'waiting') entry.note = event.note;
    else Object.assign(entry, { state: event.ok ? 'done' : 'failed', note: event.note ?? null });
  };

  const refreshSignals = async (): Promise<void> => {
    const newest = latestSignals(db).reduce((max, s) => (s.time > max ? s.time : max), '');
    if (newest && Date.now() - Date.parse(newest) < config.schedule.signalsMinutes * 60_000) return;
    await runSignals(db, config, ctx.resolve);
  };

  const refreshCategories = async (): Promise<void> => {
    try {
      if ((await fetchMissingCategories(db, config, ctx.resolve, ctx.categories)) > 0) loadLearned(db, ctx.learned);
    } catch (err) {
      log.warn(err);
    }
  };

  const refreshLogos = async (): Promise<void> => {
    try {
      const chainsAt = Number(getSetting(db, 'zerion_chains_at') ?? 0);
      if (config.zerion.apiKey && Date.now() - chainsAt > 7 * 24 * 60 * 60_000) {
        noteLogos(db, await fetchChains(config.zerion.apiKey));
        setSetting(db, 'zerion_chains_at', String(Date.now()));
      }
      await fetchMissingLogos(db, config, wantedLogos(currentState(db, 'all'), ctx.resolve));
    } catch (err) {
      log.warn(err);
    }
  };

  const collect = (): Promise<void> => {
    collecting ??= runCollection(db, config, track)
      .then(() => {
        if (progress) progress.phase = 'signals';
        return refreshSignals();
      })
      .then(() => {
        void refreshLogos();
        void refreshCategories();
      })
      .catch((err: unknown) => log.error(err))
      .finally(() => {
        collecting = null;
        progress = null;
        lastFinishedAt = Date.now();
      });
    return collecting;
  };

  return {
    get running() {
      return collecting !== null;
    },
    get progress() {
      return progress;
    },
    intervalMs,
    collect,
    collectAfterCurrent() {
      void (collecting ?? Promise.resolve()).then(collect);
    },
    gate() {
      if (ctx.demo) return { allowed: false, reason: 'Demo data. Updates are off', availableAt: null };
      return updateGate({
        running: collecting !== null,
        lastFinishedAt,
        zerionWallets: listWallets(db, 'all', 'evm').length + listWallets(db, 'all', 'solana').length,
        zerionUsedUp: zerionDayUsedUp(),
        zerionRenewsAt: zerionQuota().dayResetsAt,
      });
    },
    start() {
      if (ctx.demo) {
        void refreshLogos();
        return;
      }
      setInterval(collect, intervalMs).unref();
      const last = listSnapshots(db).at(-1);
      if (!last || Date.now() - Date.parse(last.startedAt) > intervalMs) void collect();
      else
        void refreshSignals()
          .then(refreshLogos)
          .catch((err: unknown) => log.error(err));
    },
  };
}
