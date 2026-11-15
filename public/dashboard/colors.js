export const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];
export const OTHER_COLOR = '#6b7480';
export const CATEGORY_ORDER = ['L1', 'BTC', 'Stablecoins', 'Memes', 'DeFi', 'Stocks', 'ETH', 'L2'];
export const assigned = { category: new Map(CATEGORY_ORDER.map((name, i) => [name, PALETTE[i]])) };

export function colorOf(dimension, name) {
  if (name === 'Other') return OTHER_COLOR;
  const map = (assigned[dimension] ??= new Map());
  if (!map.has(name)) map.set(name, map.size < PALETTE.length ? PALETTE[map.size] : OTHER_COLOR);
  return map.get(name);
}
