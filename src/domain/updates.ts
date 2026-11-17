export interface UpdatePlan {
  dayLimit: number;
  assumed: boolean;
  gapMinutes: number;
  defiEveryMinutes: number;
  runsPerDay: number | null;
}

const ASSUMED_DAY_LIMIT = 500;
export const DAY_SHARE = 0.9;
export const DEFI_SHARE = 0.25;
export const MIN_GAP_MINUTES = 10;
export const MIN_DEFI_MINUTES = 55;
const COOLDOWN_MINUTES = 1;
const DAY_MINUTES = 24 * 60;
const STEP_MINUTES = 5;

const roundUp = (minutes: number): number => Math.ceil(minutes / STEP_MINUTES) * STEP_MINUTES;

export function planUpdates(dayLimit: number | null, evm: number, solana: number): UpdatePlan {
  const limit = dayLimit ?? ASSUMED_DAY_LIMIT;
  const assumed = dayLimit === null;
  const wallets = evm + solana;
  if (wallets === 0) {
    return {
      dayLimit: limit,
      assumed,
      gapMinutes: COOLDOWN_MINUTES,
      defiEveryMinutes: MIN_DEFI_MINUTES,
      runsPerDay: null,
    };
  }
  const budget = limit * DAY_SHARE;
  const defiEveryMinutes =
    evm === 0 ? MIN_DEFI_MINUTES : Math.max(MIN_DEFI_MINUTES, roundUp((DAY_MINUTES * evm) / (budget * DEFI_SHARE)));
  const defiPerDay = (evm * DAY_MINUTES) / defiEveryMinutes;
  const runsPerDay = Math.max(1, Math.floor((budget - defiPerDay) / wallets));
  const gapMinutes = Math.max(MIN_GAP_MINUTES, roundUp(DAY_MINUTES / runsPerDay));
  return { dayLimit: limit, assumed, gapMinutes, defiEveryMinutes, runsPerDay: Math.floor(DAY_MINUTES / gapMinutes) };
}
