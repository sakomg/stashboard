import type { FastifyBaseLogger } from 'fastify';
import { fetchMissingCategories, loadLearned } from '../services/categories.ts';
import { planUpdates, type UpdatePlan } from '../domain/updates.ts';
import { runCollection, updateGate, type ProgressEvent, type UpdateGate } from '../services/collector.ts';
import { fetchMissingLogos, noteLogos } from '../services/logos.ts';
import { runSignals } from '../services/signals.ts';
import { wantedLogos } from '../services/view.ts';
import { fetchChains, seedZerionDayLimit, zerionDayUsedUp, zerionQuota } from '../sources/zerion.ts';
import { currentState, getSetting, listSnapshots, listWallets, setSetting } from '../storage/index.ts';
import type { Context } from './context.ts';

interface Progress {
  phase: 'accounts' | 'signals';
  startedAt: number;
  accounts: { id: number; state: 'waiting' | 'reading' | 'done' | 'failed'; note: string | null }[];
}

const GUESS_PER_ACCOUNT_MS = 3000;

function startsIn({ phase, startedAt, accounts }: Progress, own: Set<number>, now: number): number | null {
  const first = accounts.findIndex((a) => own.has(a.id));
  if (phase !== 'accounts' || first < 0) return null;
  if (accounts.some((a) => own.has(a.id) && a.state !== 'waiting')) return null;
  const ahead = accounts.slice(0, first).filter((a) => a.state === 'waiting' || a.state === 'reading').length;
  const finished = accounts.filter((a) => a.state === 'done' || a.state === 'failed').length;
  return Math.round(ahead * (finished > 0 ? (now - startedAt) / finished : GUESS_PER_ACCOUNT_MS));
}

export function progressFor(progress: Progress | null, own: Set<number>, now = Date.now()) {
  if (!progress) return null;
  return {
    phase: progress.phase,
    accounts: progress.accounts.filter((a) => own.has(a.id)),
    startsIn: startsIn(progress, own, now),
  };
}

export interface Collection {
  readonly running: boolean;
  readonly progress: Progress | null;
  readonly everyMinutes: number;
  collect(): Promise<void>;
  readAccount(accountId: number): Promise<void>;
  gate(): UpdateGate;
  start(): void;
}

const LAST_FULL_RUN = 'collected_all_at';
const ZERION_DAY_LIMIT = 'zerion_day_limit';
const SIGNALS_AT = 'signals_at';

export function createCollection(ctx: Context, log: FastifyBaseLogger): Collection {
  const { db, config } = ctx;
  let progress: Progress | null = null;
  let queue: Promise<void> = Promise.resolve();
  let jobs = 0;
  let fullRun: Promise<void> | null = null;
  let timer: NodeJS.Timeout | undefined;
  let lastStartedAt =
    Number(getSetting(db, LAST_FULL_RUN) ?? 0) || Date.parse(listSnapshots(db).at(-1)?.startedAt ?? '') || 0;

  const knownLimit = Number(getSetting(db, ZERION_DAY_LIMIT));
  if (knownLimit > 0) seedZerionDayLimit(knownLimit);

  const plan = (): UpdatePlan =>
    planUpdates(zerionQuota().dayLimit, listWallets(db, 'all', 'evm').length, listWallets(db, 'all', 'solana').length);
  const everyMs = (): number => Math.max(config.schedule.balancesMinutes, 5, plan().gapMinutes) * 60_000;

  const track = (event: ProgressEvent): void => {
    if (event.type === 'start') {
      progress = {
        phase: 'accounts',
        startedAt: Date.now(),
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
    if (Date.now() - Number(getSetting(db, SIGNALS_AT) ?? 0) < config.schedule.signalsMinutes * 60_000) return;
    await runSignals(db, config, ctx.resolve);
    setSetting(db, SIGNALS_AT, String(Date.now()));
  };

  const signalsFor = async (accountId: number): Promise<void> => {
    const state = currentState(db, 'all').find((s) => s.account.id === accountId);
    await runSignals(db, config, ctx.resolve, new Set(state?.holdings.map((h) => ctx.resolve(h.symbol).key)));
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

  const rememberLimit = (): void => {
    const { dayLimit } = zerionQuota();
    if (dayLimit !== null && String(dayLimit) !== getSetting(db, ZERION_DAY_LIMIT))
      setSetting(db, ZERION_DAY_LIMIT, String(dayLimit));
  };

  const enqueue = (job: () => Promise<void>): Promise<void> => {
    jobs++;
    const run = queue
      .then(job)
      .catch((err: unknown) => log.error(err))
      .finally(() => {
        jobs--;
        progress = null;
      });
    queue = run;
    return run;
  };

  const arm = (): void => {
    clearTimeout(timer);
    if (ctx.demo) return;
    timer = setTimeout(() => void collect(), Math.max(0, lastStartedAt + everyMs() - Date.now()));
    timer.unref();
  };

  const collect = (): Promise<void> => {
    fullRun ??= enqueue(async () => {
      lastStartedAt = Date.now();
      setSetting(db, LAST_FULL_RUN, String(lastStartedAt));
      await runCollection(db, config, track, { defiEveryMs: plan().defiEveryMinutes * 60_000 });
      rememberLimit();
      if (progress) progress.phase = 'signals';
      await refreshSignals();
      void refreshLogos();
      void refreshCategories();
    }).finally(() => {
      fullRun = null;
      arm();
    });
    return fullRun;
  };

  const readAccount = (accountId: number): Promise<void> =>
    enqueue(async () => {
      await runCollection(db, config, track, { only: [accountId], defiEveryMs: plan().defiEveryMinutes * 60_000 });
      rememberLimit();
      if (progress) progress.phase = 'signals';
      await signalsFor(accountId);
      void refreshLogos();
      void refreshCategories();
    });

  return {
    get running() {
      return jobs > 0;
    },
    get progress() {
      return progress;
    },
    get everyMinutes() {
      return everyMs() / 60_000;
    },
    collect,
    readAccount,
    gate() {
      if (ctx.demo) return { allowed: false, reason: 'Demo data. Updates are off', availableAt: null };
      return updateGate({
        running: jobs > 0,
        lastStartedAt,
        gapMinutes: plan().gapMinutes,
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
      if (Date.now() - lastStartedAt >= everyMs()) void collect();
      else {
        arm();
        void refreshSignals()
          .then(refreshLogos)
          .catch((err: unknown) => log.error(err));
      }
    },
  };
}
