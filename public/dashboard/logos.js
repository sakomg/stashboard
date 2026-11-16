import { h } from '/common/ui.js';
import { state } from './state.js';

export function monogram(label) {
  return h(
    'span',
    { class: 'logo mono', 'aria-hidden': 'true' },
    String(label)
      .replace(/[^\p{L}\p{N}]/gu, '')
      .slice(0, 2)
      .toUpperCase() || '?',
  );
}

export function logo(kind, key, label = key) {
  const version = state.logos.get(`${kind}/${key}`);
  if (!version) return monogram(label);
  const img = h('img', {
    class: 'logo',
    src: `/logo/${kind}/${encodeURIComponent(key)}?v=${version}`,
    alt: '',
    width: 20,
    height: 20,
    loading: 'lazy',
  });
  img.addEventListener('error', () => img.replaceWith(monogram(label)));
  return img;
}

export const EXCHANGES = { binance: 'Binance', bybit: 'Bybit', okx: 'OKX' };
export const isExchange = (kind) => Object.hasOwn(EXCHANGES, kind);
export const KIND_TOKEN = { binance: 'BNB', okx: 'OKB', evm: 'ETH', solana: 'SOL', ton: 'TON' };
export const CHAIN_TOKEN = { binance: 'BNB', okx: 'OKB', ton: 'TON' };
export const kindLogo = (kind) =>
  KIND_TOKEN[kind] ? logo('token', KIND_TOKEN[kind], KINDS[kind]) : monogram(KINDS[kind]);
export const chainLogo = (id) =>
  CHAIN_TOKEN[id] ? logo('token', CHAIN_TOKEN[id], chainName(id)) : logo('chain', id, chainName(id));

export const KINDS = { ...EXCHANGES, evm: 'EVM', solana: 'Solana', ton: 'TON' };
export const TYPES = {
  wallet: 'Wallet',
  earn: 'Earn',
  staked: 'Staked',
  deposit: 'Deposited',
  borrow: 'Borrowed',
  lp: 'Liquidity',
  futures: 'Futures',
  margin: 'Margin',
  locked: 'Locked',
  reward: 'Reward',
};
export const CHAINS = { ...EXCHANGES, ton: 'TON' };
export const chainName = (id) =>
  CHAINS[id] ??
  state.chainNames[id] ??
  id.replace(/(^|-)(\w)/g, (_, hyphen, c) => (hyphen ? ' ' : '') + c.toUpperCase());
