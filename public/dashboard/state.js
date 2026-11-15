export const $ = (id) => document.getElementById(id);
export const actions = { load: async () => {}, renderAll: async () => {}, watchProgress: () => {} };

export const DUST_USD = 1;

export const state = {
  data: null,
  build: null,
  logos: new Map(),
  chainNames: {},
  dimension: 'category',
  period: '30',
  sort: { key: 'value', descending: true },
  expanded: new Set(),
  showDust: false,
  renaming: null,
  updating: false,
  hideAmounts: false,
  signalZone: null,
  shareDimension: 'category',
  view: 'overview',
  progress: null,
};

export const hasBalances = () => state.data.holdings.length > 0;
export const firstRead = () => !hasBalances() && busy();

export const busy = () => state.updating || state.data?.collecting || state.progress !== null;
