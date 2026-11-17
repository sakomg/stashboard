import { h } from '/common/ui.js';
import { dash } from './format.js';

export const ZONES = { cold: 'Cold', neutral: 'Neutral', warm: 'Warm', overheated: 'Overheated' };

export function heatBadge(signal) {
  if (!signal) return dash();
  return h(
    'span',
    { class: `heat ${signal.zone}`, title: `Heat ${signal.score.toFixed(0)} of 100, from ${signal.pair}` },
    h('b', { class: 'num' }, signal.score.toFixed(0)),
    ZONES[signal.zone],
  );
}
