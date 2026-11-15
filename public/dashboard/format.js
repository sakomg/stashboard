import { h } from '/common/ui.js';
import { state } from './state.js';

export const MASK = '•••••';
export const money = (n) => (state.hideAmounts ? `$${MASK}` : usd(n));
export const moneyRound = (n) => (state.hideAmounts ? `$${MASK}` : usdRound(n));
export const units = (n) => (state.hideAmounts ? MASK.slice(0, 3) : quantity(n));
export const usd = (n) =>
  `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const usdRound = (n) =>
  `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
export const quantity = (n) => n.toLocaleString('en-US', { maximumSignificantDigits: 6 });
export const price = (n) => (n == null ? '—' : `$${n.toLocaleString('en-US', { maximumSignificantDigits: 5 })}`);
export const fixed = (n, digits) =>
  (Number(n.toFixed(digits)) === 0 ? (0).toFixed(digits) : n.toFixed(digits)).replace('-', '−');
export const signedPercent = (v) => {
  const rounded = Math.round(v);
  return rounded === 0 ? '0%' : `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}%`;
};
export const percent = (n) => `${(n * 100).toFixed(1)}%`;
export const dash = () => h('span', { class: 'muted' }, '—');

export function change(n) {
  if (n == null) return h('span', { class: 'num muted' }, '—');
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return h(
    'span',
    { class: `num ${n > 0 ? 'up' : n < 0 ? 'down' : 'muted'}` },
    `${sign}${Math.abs(n * 100).toFixed(1)}%`,
  );
}

export function ago(iso) {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return `${Math.round(minutes / 1440)} d ago`;
}

export function inTime(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 90) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 36 ? `${hours} h` : `${Math.round(hours / 24)} days`;
}
