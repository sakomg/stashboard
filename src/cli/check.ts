import { loadConfig, type Config } from '../lib/config.ts';
import { listAccounts, listWallets, openDb, type Wallet } from '../storage/index.ts';
import { checkBinanceKey, exchangeKeys, type ExchangeKeys } from '../services/exchanges.ts';
import { getJson } from '../lib/http.ts';
import { binanceSigned } from '../sources/binance.ts';
import { fetchChains, zerionQuota } from '../sources/zerion.ts';

type Status = 'ok' | 'warn' | 'fail' | 'skip';
const MARK: Record<Status, string> = { ok: '✓', warn: '!', fail: '✗', skip: '–' };
const results: Status[] = [];

function report(status: Status, source: string, message: string): void {
  results.push(status);
  console.log(`${MARK[status]} ${source.padEnd(12)} ${message}`);
}

const usd = (n: number): string => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const short = (a: string): string => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function step(source: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    report('fail', source, errText(err));
  }
}

async function checkBinance(cfg: Config['binance'], stored: { label: string; keys: ExchangeKeys }[]): Promise<void> {
  await step('Binance pub', async () => {
    await getJson('https://api.binance.com/api/v3/ping');
    await getJson('https://fapi.binance.com/fapi/v1/ping');
    report('ok', 'Binance pub', 'spot and futures APIs are reachable from this IP');
  });

  const accounts =
    stored.length > 0 ? stored : cfg.apiKey && cfg.apiSecret ? [{ label: 'config.json', keys: cfg }] : [];
  if (accounts.length === 0) return report('skip', 'Binance', 'no exchange added');

  for (const { label, keys } of accounts) {
    await step('Binance', async () => {
      const { extra, ipRestricted } = await checkBinanceKey(keys);
      if (extra.length > 0) report('fail', 'Binance', `${label}: key can do more than read: ${extra.join(', ')}`);
      else if (!ipRestricted) report('warn', 'Binance', `${label}: key is read-only but not restricted to trusted IPs`);
      else report('ok', 'Binance', `${label}: key is read-only and IP-restricted`);

      const acc = await binanceSigned<{ balances: { free: string; locked: string }[] }>(keys, '/api/v3/account');
      const nonZero = acc.balances.filter((b) => Number(b.free) + Number(b.locked) > 0).length;
      report('ok', 'Binance', `${label}: spot account is readable, non-zero assets: ${nonZero}`);
    });
  }
}

async function checkZerion(cfg: Config['zerion'], wallets: Wallet[]): Promise<void> {
  if (!cfg.apiKey) return report('skip', 'Zerion', 'key is not set');
  await step('Zerion', async () => {
    const chains = await fetchChains(cfg.apiKey);
    const q = zerionQuota();
    const allowance =
      q.dayLimit === null
        ? ''
        : `, ${q.tier ?? 'unknown'} tier: ${q.dayRemaining ?? '?'} of ${q.dayLimit} requests left today`;
    report(
      'ok',
      'Zerion',
      `key works, ${chains.length} chains${allowance}, ${wallets.length} wallets are read on collection`,
    );
  });
}

async function checkTon(cfg: Config['tonapi'], ton: Wallet[]): Promise<void> {
  if (ton.length === 0) return report('skip', 'TonAPI', 'no TON wallets');
  if (!cfg.apiKey) report('warn', 'TonAPI', 'key is not set, requests go without it');
  const headers: Record<string, string> = cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {};

  for (const w of ton) {
    await step('TonAPI', async () => {
      const acc = await getJson<{ balance: number }>(`https://tonapi.io/v2/accounts/${w.address}`, headers);
      const jettons = await getJson<{ balances: { balance: string }[] }>(
        `https://tonapi.io/v2/accounts/${w.address}/jettons?currencies=usd`,
        headers,
      );
      const held = jettons.balances.filter((j) => j.balance !== '0').length;
      report('ok', 'TonAPI', `${w.label} ${short(w.address)}: ${(acc.balance / 1e9).toFixed(2)} TON, jettons: ${held}`);
    });
  }
}

async function checkCoingecko(cfg: Config['coingecko']): Promise<void> {
  if (!cfg.apiKey) return report('skip', 'CoinGecko', 'key is not set');
  await step('CoinGecko', async () => {
    const r = await getJson<{ bitcoin: { usd: number } }>(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
      { 'x-cg-demo-api-key': cfg.apiKey },
    );
    report('ok', 'CoinGecko', `key works, BTC = ${usd(r.bitcoin.usd)}`);
  });
}

async function checkFearGreed(): Promise<void> {
  await step('Fear&Greed', async () => {
    const r = await getJson<{ data: { value: string; value_classification: string }[] }>(
      'https://api.alternative.me/fng/?limit=1',
    );
    const d = r.data[0];
    if (!d) throw new Error('empty response');
    report('ok', 'Fear&Greed', `${d.value} (${d.value_classification})`);
  });
}

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  console.error(errText(err));
  process.exit(1);
}

const db = openDb();
const exchanges = listAccounts(db, 'all')
  .filter((a) => a.kind === 'binance')
  .flatMap((a) => {
    const keys = exchangeKeys(db, a.id);
    return keys ? [{ label: a.label, keys }] : [];
  });
await checkBinance(config.binance, exchanges);
await checkZerion(config.zerion, [...listWallets(db, 'all', 'evm'), ...listWallets(db, 'all', 'solana')]);
await checkTon(config.tonapi, listWallets(db, 'all', 'ton'));
await checkCoingecko(config.coingecko);
await checkFearGreed();

const count = (s: Status): number => results.filter((r) => r === s).length;
console.log(
  `\nResult: ${count('ok')} ok, ${count('warn')} warnings, ${count('fail')} failed, ${count('skip')} skipped`,
);
process.exit(count('fail') > 0 ? 1 : 0);
