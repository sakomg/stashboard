export const $ = (id) => document.getElementById(id);
export const actions = { load: async () => {}, renderAll: async () => {}, watchProgress: () => {} };

export const DUST_USD = 1;

export const viewing = /^\/board\/([A-Za-z0-9_-]+)$/.exec(location.pathname)?.[1] ?? null;
export const apiBase = viewing ? `/api/board/${viewing}` : '/api';

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
  board: null,
};

export const hasBalances = () => state.data.holdings.length > 0;
export const firstRead = () => !hasBalances() && busy();

export const busy = () => state.updating || state.data?.collecting || state.progress !== null;
