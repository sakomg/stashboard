export interface UpdatePlan {
  gapMinutes: number;
  defiEveryMinutes: number;
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
  const wallets = evm + solana;
  if (wallets === 0) return { gapMinutes: COOLDOWN_MINUTES, defiEveryMinutes: MIN_DEFI_MINUTES };
  const budget = (dayLimit ?? ASSUMED_DAY_LIMIT) * DAY_SHARE;
  const defiEveryMinutes =
    evm === 0 ? MIN_DEFI_MINUTES : Math.max(MIN_DEFI_MINUTES, roundUp((DAY_MINUTES * evm) / (budget * DEFI_SHARE)));
  const defiPerDay = (evm * DAY_MINUTES) / defiEveryMinutes;
  const runsPerDay = Math.max(1, Math.floor((budget - defiPerDay) / wallets));
  return { gapMinutes: Math.max(MIN_GAP_MINUTES, roundUp(DAY_MINUTES / runsPerDay)), defiEveryMinutes };
}
