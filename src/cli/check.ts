import { loadConfig, type Config } from '../lib/config.ts';
import { listAccounts, listWallets, openDb, type Wallet } from '../storage/index.ts';
import {
  CLIENTS,
  EXCHANGE_KINDS,
  EXCHANGES,
  exchangeKeys,
  type ExchangeKeys,
  type ExchangeKind,
} from '../services/exchanges.ts';
import { getJson } from '../lib/http.ts';
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

async function checkExchange(kind: ExchangeKind, accounts: { label: string; keys: ExchangeKeys }[]): Promise<void> {
  const name = EXCHANGES[kind];
  const client = CLIENTS[kind];
  if (kind === 'binance' || accounts.length > 0) {
    await step(`${name} pub`, async () => report('ok', `${name} pub`, await client.ping()));
  }
  if (accounts.length === 0) return report('skip', name, 'no exchange added');

  for (const { label, keys } of accounts) {
    await step(name, async () => {
      const { extra, ipRestricted } = await client.check(keys);
      if (extra.length > 0) report('fail', name, `${label}: key can do more than read: ${extra.join(', ')}`);
      else if (!ipRestricted) report('warn', name, `${label}: key is read-only but not restricted to trusted IPs`);
      else report('ok', name, `${label}: key is read-only and IP-restricted`);

      const { holdings, warnings } = await client.collect(keys);
      const notes = warnings.length > 0 ? `, ${warnings.length} notes, see npm run collect` : '';
      report('ok', name, `${label}: balances are readable, ${holdings.length} read${notes}`);
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
for (const kind of EXCHANGE_KINDS) {
  const stored = listAccounts(db, 'all')
    .filter((a) => a.kind === kind)
    .flatMap((a) => {
      const keys = exchangeKeys(db, a.id);
      return keys ? [{ label: a.label, keys }] : [];
    });
  const seed = config.binance;
  const fromConfig = kind === 'binance' && stored.length === 0 && seed.apiKey && seed.apiSecret;
  await checkExchange(kind, fromConfig ? [{ label: 'config.json', keys: seed }] : stored);
}
await checkZerion(config.zerion, [...listWallets(db, 'all', 'evm'), ...listWallets(db, 'all', 'solana')]);
await checkTon(config.tonapi, listWallets(db, 'all', 'ton'));
await checkCoingecko(config.coingecko);
await checkFearGreed();

const count = (s: Status): number => results.filter((r) => r === s).length;
console.log(
  `\nResult: ${count('ok')} ok, ${count('warn')} warnings, ${count('fail')} failed, ${count('skip')} skipped`,
);
process.exit(count('fail') > 0 ? 1 : 0);
