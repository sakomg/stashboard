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
const CHAIN_FALLBACK = { ethereum: 'ETH', 'binance-smart-chain': 'BNB', solana: 'SOL' };
export const hasLogo = (spec) => Boolean(spec?.key) && state.logos.has(`${spec.kind}/${spec.key}`);

const exchangeFirst = (id, token) => {
  const exchange = { kind: 'exchange', key: id };
  return isExchange(id) && (hasLogo(exchange) || !token) ? exchange : { kind: 'token', key: token };
};
export const kindLogoSpec = (kind) => exchangeFirst(kind, KIND_TOKEN[kind]);
export const chainLogoSpec = (id) => {
  if (isExchange(id)) return exchangeFirst(id, CHAIN_TOKEN[id]);
  if (CHAIN_TOKEN[id]) return { kind: 'token', key: CHAIN_TOKEN[id] };
  const chain = { kind: 'chain', key: id };
  return hasLogo(chain) || !CHAIN_FALLBACK[id] ? chain : { kind: 'token', key: CHAIN_FALLBACK[id] };
};
export const kindLogo = (kind) => {
  const spec = kindLogoSpec(kind);
  return spec.key ? logo(spec.kind, spec.key, KINDS[kind]) : monogram(KINDS[kind]);
};
export const chainLogo = (id) => {
  const spec = chainLogoSpec(id);
  return logo(spec.kind, spec.key, chainName(id));
};

export const EVM_CHAINS = {
  ethereum: 'Ethereum',
  base: 'Base',
  arbitrum: 'Arbitrum',
  'binance-smart-chain': 'BNB Chain',
  optimism: 'Optimism',
  polygon: 'Polygon',
};

export function logoStack(logos) {
  const shown = logos.filter(Boolean);
  return shown.length > 0 ? h('span', { class: 'logo-stack', 'aria-hidden': 'true' }, shown) : null;
}

export const chainStack = (ids) => logoStack(ids.filter((id) => hasLogo(chainLogoSpec(id))).map(chainLogo));
export const walletStack = () => logoStack(['evm', 'solana', 'ton'].map(kindLogo));
export const exchangeStack = () => logoStack(Object.keys(EXCHANGES).map(kindLogo));

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
