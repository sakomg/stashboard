import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.ts';
import { addWallet, openDb, saveSignals, type Account } from './db.ts';
import { heatScore, type Readings } from './heat.ts';
import type { HoldingType } from './types.ts';
import { seal, vaultKey } from './vault.ts';

process.env.DATA_DIR ??= 'data-demo';
process.env.CONFIG_PATH ??= 'config.example.json';
process.env.DEMO = '1';

const dir = process.env.DATA_DIR;
for (const suffix of ['', '-wal', '-shm']) rmSync(join(dir, `stashboard.db${suffix}`), { force: true });
const db = openDb(dir);
const config = loadConfig();

let seed = 20_261_115;
const random = (): number => {
  seed = (seed * 1_664_525 + 1_013_904_223) % 4_294_967_296;
  return seed / 4_294_967_296;
};

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes: number[]): string {
  let n = BigInt(`0x${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}`);
  let out = '';
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out;
}
const bytes = (count: number): number[] => Array.from({ length: count }, () => Math.floor(random() * 256));

const exchange = Number(
  db.prepare("INSERT INTO accounts (kind, label, address, address_key) VALUES ('binance', 'Binance', '', 'demo')").run()
    .lastInsertRowid,
);
db.prepare('INSERT INTO exchange_keys (account_id, key_hint, sealed) VALUES (?, ?, ?)').run(
  exchange,
  '…demo',
  seal(vaultKey(dir), { apiKey: 'demo', apiSecret: 'demo' }),
);
const ledger: Account = addWallet(db, '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359', 'Ledger');
const phantom: Account = addWallet(db, base58([1, ...bytes(31)]), 'Phantom');
const tonkeeper: Account = addWallet(
  db,
  `0:${bytes(32)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')}`,
  'Tonkeeper',
);

const TODAY: Record<string, number> = {
  BTC: 65_400,
  ETH: 1_832,
  SOL: 72.6,
  BNB: 597,
  TON: 1.05,
  ARB: 0.136,
  LDO: 0.274,
  JUP: 0.41,
  BONK: 0.0000142,
  NOT: 0.000303,
  NVDA: 160.6,
  USDC: 1,
  USDT: 1,
};
const PRICE_OF: Record<string, string> = { WETH: 'ETH', JitoSOL: 'SOL', NVDAB: 'NVDA' };
const RATIO: Record<string, number> = { JitoSOL: 1.16 };

const STEPS = 90 * 4;
const STEP_MS = 6 * 60 * 60_000;
const prices = new Map<string, number[]>();
for (const [symbol, today] of Object.entries(TODAY)) {
  const series = new Array<number>(STEPS + 1);
  series[STEPS] = today;
  const stable = symbol === 'USDC' || symbol === 'USDT';
  const volatility = symbol === 'BONK' || symbol === 'NOT' ? 0.035 : symbol === 'NVDA' ? 0.012 : 0.016;
  for (let i = STEPS - 1; i >= 0; i--) {
    series[i] = stable ? 1 : series[i + 1]! * (1 + 0.0011 + volatility * (random() - 0.5) * 2);
  }
  prices.set(symbol, series);
}
const priceAt = (symbol: string, step: number): number =>
  prices.get(PRICE_OF[symbol] ?? symbol)![step]! * (RATIO[symbol] ?? 1);

interface Position {
  account: number;
  chain: string;
  protocol: string | null;
  symbol: string;
  type: HoldingType;
  quantity: (step: number) => number;
}
const fixed = (q: number) => () => q;
const POSITIONS: Position[] = [
  { account: exchange, chain: 'binance', protocol: 'Spot', symbol: 'BTC', type: 'wallet', quantity: fixed(0.118) },
  { account: exchange, chain: 'binance', protocol: 'Spot', symbol: 'BNB', type: 'wallet', quantity: fixed(3.2) },
  { account: exchange, chain: 'binance', protocol: 'Earn', symbol: 'USDT', type: 'earn', quantity: fixed(2_450) },
  { account: exchange, chain: 'binance', protocol: 'Earn', symbol: 'SOL', type: 'earn', quantity: fixed(38) },
  { account: exchange, chain: 'binance', protocol: 'Spot', symbol: 'NVDAB', type: 'wallet', quantity: fixed(6) },
  {
    account: ledger.id,
    chain: 'ethereum',
    protocol: null,
    symbol: 'ETH',
    type: 'wallet',
    quantity: (step) => (step < 240 ? 3.1 : 4.2),
  },
  { account: ledger.id, chain: 'ethereum', protocol: null, symbol: 'LDO', type: 'wallet', quantity: fixed(1_150) },
  { account: ledger.id, chain: 'arbitrum', protocol: null, symbol: 'ARB', type: 'wallet', quantity: fixed(3_200) },
  { account: ledger.id, chain: 'base', protocol: null, symbol: 'USDC', type: 'wallet', quantity: fixed(3_900) },
  { account: ledger.id, chain: 'arbitrum', protocol: 'Aave V3', symbol: 'WETH', type: 'deposit', quantity: fixed(1.5) },
  {
    account: ledger.id,
    chain: 'arbitrum',
    protocol: 'Aave V3',
    symbol: 'USDC',
    type: 'borrow',
    quantity: fixed(1_000),
  },
  { account: phantom.id, chain: 'solana', protocol: null, symbol: 'SOL', type: 'wallet', quantity: fixed(21) },
  { account: phantom.id, chain: 'solana', protocol: 'Jito', symbol: 'JitoSOL', type: 'staked', quantity: fixed(30) },
  { account: phantom.id, chain: 'solana', protocol: null, symbol: 'JUP', type: 'wallet', quantity: fixed(2_400) },
  {
    account: phantom.id,
    chain: 'solana',
    protocol: null,
    symbol: 'BONK',
    type: 'wallet',
    quantity: (step) => (step < 300 ? 25_000_000 : 48_000_000),
  },
  { account: tonkeeper.id, chain: 'ton', protocol: null, symbol: 'TON', type: 'wallet', quantity: fixed(880) },
  { account: tonkeeper.id, chain: 'ton', protocol: null, symbol: 'NOT', type: 'wallet', quantity: fixed(1_400_000) },
];

const now = Date.now();
const insertSnapshot = db.prepare('INSERT INTO snapshots (started_at, finished_at) VALUES (?, ?)');
const insertOutcome = db.prepare(
  "INSERT INTO snapshot_accounts (snapshot_id, account_id, status, warnings) VALUES (?, ?, 'ok', '[]')",
);
const insertHolding = db.prepare(
  `INSERT INTO holdings (snapshot_id, account_id, chain, protocol, symbol, type, quantity, price, value_usd)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);
const accounts = [exchange, ledger.id, phantom.id, tonkeeper.id];
db.exec('BEGIN');
for (let step = 0; step <= STEPS; step++) {
  const at = new Date(now - (STEPS - step) * STEP_MS - 60 * 60_000).toISOString();
  const id = Number(insertSnapshot.run(at, at).lastInsertRowid);
  for (const account of accounts) insertOutcome.run(id, account);
  for (const p of POSITIONS) {
    const quantity = p.quantity(step);
    const price = priceAt(p.symbol, step);
    const value = quantity * price * (p.type === 'borrow' ? -1 : 1);
    insertHolding.run(id, p.account, p.chain, p.protocol, p.symbol, p.type, quantity, price, value);
  }
}
db.exec('COMMIT');

const READINGS: Record<string, Readings> = {
  BTC: { rsiDaily: 27, rsiWeekly: 34, funding: 0.004, ma200: -24, oiGrowth: -6 },
  ETH: { rsiDaily: 24, rsiWeekly: 31, funding: 0.002, ma200: -38, oiGrowth: -9 },
  SOL: { rsiDaily: 36, rsiWeekly: 41, funding: 0.006, ma200: -21, oiGrowth: 2 },
  BNB: { rsiDaily: 44, rsiWeekly: 47, funding: 0.008, ma200: -4, oiGrowth: 1 },
  TON: { rsiDaily: 45, rsiWeekly: 47, funding: 0.01, ma200: 3, oiGrowth: 0 },
  ARB: { rsiDaily: 31, rsiWeekly: 38, funding: -0.004, ma200: -29, oiGrowth: -3 },
  LDO: { rsiDaily: 39, rsiWeekly: 40, funding: 0.005, ma200: -22, oiGrowth: 0 },
  JUP: { rsiDaily: 52, rsiWeekly: 49, funding: 0.011, ma200: 6, oiGrowth: 4 },
  BONK: { rsiDaily: 79, rsiWeekly: 72, funding: 0.046, ma200: 64, oiGrowth: 38 },
  NOT: { rsiDaily: 67, rsiWeekly: 62, funding: 0.024, ma200: 29, oiGrowth: 14 },
  NVDA: { rsiDaily: 57, rsiWeekly: 55, funding: null, ma200: 9, oiGrowth: null },
};
saveSignals(
  db,
  Object.entries(READINGS).flatMap(([asset, readings]) => {
    const heat = heatScore(readings, config.heat);
    return heat ? [{ asset, time: new Date(now - 40 * 60_000).toISOString(), pair: `${asset}USDT`, ...heat }] : [];
  }),
);
db.close();

console.log(`Demo data written to ${dir}. Nothing in it is real, and the demo does not call any balance API.`);
await import('./server.ts');
