import { h } from '/common/ui.js';
import { dash, fixed, signedPercent } from './format.js';

export const reading = (a, name) => a.signal?.components.find((c) => c.name === name)?.value ?? null;

export const ZONES = { cold: 'Cold', neutral: 'Neutral', warm: 'Warm', overheated: 'Overheated' };
export const READINGS = {
  rsiDaily: ['Daily RSI', (v) => v.toFixed(0)],
  rsiWeekly: ['Weekly RSI', (v) => v.toFixed(0)],
  funding: ['Funding', (v) => `${fixed(v, 4)}% per 8 h`],
  ma200: ['Price against its 200-day average', signedPercent],
  oiGrowth: ['Open interest over 7 days', signedPercent],
};

export function heatBadge(signal) {
  if (!signal) return dash();
  return h(
    'span',
    { class: `heat ${signal.zone}`, title: `Heat ${signal.score.toFixed(0)} of 100, from ${signal.pair}` },
    h('b', { class: 'num' }, signal.score.toFixed(0)),
    ZONES[signal.zone],
  );
}
