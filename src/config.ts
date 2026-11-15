import { readFileSync } from 'node:fs';

export interface Config {
  binance: { apiKey: string; apiSecret: string };
  zerion: { apiKey: string };
  tonapi: { apiKey: string };
  coingecko: { apiKey: string };
  /** Public host name the dashboard is served on; used by the deploy for HTTPS. */
  domain: string;
  schedule: { balancesMinutes: number; signalsMinutes: number };
  heat: {
    weights: { rsiDaily: number; rsiWeekly: number; funding: number; ma200: number; oiGrowth: number };
    overheated: {
      rsiDaily: number;
      rsiWeekly: number;
      funding8hPct: number;
      ma200Pct: number;
      oiGrowth7dPct: number;
    };
    zones: { neutral: number; warm: number; overheated: number };
  };
}

const DEFAULTS: Pick<Config, 'schedule' | 'heat'> = {
  schedule: { balancesMinutes: 60, signalsMinutes: 240 },
  heat: {
    weights: { rsiDaily: 30, rsiWeekly: 25, funding: 20, ma200: 15, oiGrowth: 10 },
    overheated: { rsiDaily: 70, rsiWeekly: 75, funding8hPct: 0.03, ma200Pct: 50, oiGrowth7dPct: 30 },
    zones: { neutral: 30, warm: 60, overheated: 80 },
  },
};

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Numeric settings: take what the file sets, fall back to defaults for the rest. */
function numbers<T extends Record<string, number>>(raw: unknown, defaults: T, path: string): T {
  const src = obj(raw);
  const out: Record<string, number> = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const v = src[key];
    if (v === undefined) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new Error(`config: ${path}.${key} must be a non-negative number`);
    }
    out[key] = v;
  }
  return out as T;
}

export function loadConfig(path = process.env.CONFIG_PATH ?? 'config.json'): Config {
  let raw: Obj;
  try {
    raw = obj(JSON.parse(readFileSync(path, 'utf8')));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read ${path}: ${reason}\nCreate it with: cp config.example.json config.json`);
  }

  const heat = obj(raw.heat);
  return {
    binance: { apiKey: str(obj(raw.binance).apiKey), apiSecret: str(obj(raw.binance).apiSecret) },
    zerion: { apiKey: str(obj(raw.zerion).apiKey) },
    tonapi: { apiKey: str(obj(raw.tonapi).apiKey) },
    coingecko: { apiKey: str(obj(raw.coingecko).apiKey) },
    domain: str(raw.domain),
    schedule: numbers(raw.schedule, DEFAULTS.schedule, 'schedule'),
    heat: {
      weights: numbers(heat.weights, DEFAULTS.heat.weights, 'heat.weights'),
      overheated: numbers(heat.overheated, DEFAULTS.heat.overheated, 'heat.overheated'),
      zones: numbers(heat.zones, DEFAULTS.heat.zones, 'heat.zones'),
    },
  };
}
