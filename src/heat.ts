import type { Config } from './config.ts';

export type ComponentName = 'rsiDaily' | 'rsiWeekly' | 'funding' | 'ma200' | 'oiGrowth';
export type Zone = 'cold' | 'neutral' | 'warm' | 'overheated';

export type Readings = Record<ComponentName, number | null>;

export interface Component {
  name: ComponentName;
  value: number;
  score: number;
  weight: number;
}

export interface Heat {
  score: number;
  zone: Zone;
  components: Component[];
}

const NEUTRAL: Record<ComponentName, number> = { rsiDaily: 50, rsiWeekly: 50, funding: 0.01, ma200: 0, oiGrowth: 0 };

const THRESHOLD: Record<ComponentName, keyof Config['heat']['overheated']> = {
  rsiDaily: 'rsiDaily',
  rsiWeekly: 'rsiWeekly',
  funding: 'funding8hPct',
  ma200: 'ma200Pct',
  oiGrowth: 'oiGrowth7dPct',
};

export const HOT_SCORE = 80;
export const COLD_SCORE = 30;

function componentScore(name: ComponentName, value: number, heat: Config['heat']): number {
  const neutral = NEUTRAL[name];
  const span = heat.overheated[THRESHOLD[name]] - neutral;
  if (span <= 0) return 50;
  return Math.min(100, Math.max(0, 50 + ((value - neutral) / span) * (HOT_SCORE - 50)));
}

export function zoneOf(score: number, zones: Config['heat']['zones']): Zone {
  if (score >= zones.overheated) return 'overheated';
  if (score >= zones.warm) return 'warm';
  if (score >= zones.neutral) return 'neutral';
  return 'cold';
}

export function heatScore(readings: Readings, heat: Config['heat']): Heat | null {
  const available = (Object.keys(readings) as ComponentName[]).filter(
    (n) => readings[n] !== null && heat.weights[n] > 0,
  );
  const totalWeight = available.reduce((s, n) => s + heat.weights[n], 0);
  if (totalWeight === 0) return null;

  const components = available.map((name) => ({
    name,
    value: readings[name]!,
    score: componentScore(name, readings[name]!, heat),
    weight: heat.weights[name] / totalWeight,
  }));
  const score = components.reduce((s, c) => s + c.score * c.weight, 0);
  return { score, zone: zoneOf(score, heat.zones), components };
}
