// Stage 0: verifies every API key in config.json and every wallet in the database.
// Run: npm run check (locally) or ./deploy.sh user@host (from the server's IP).
import { createHmac } from 'node:crypto';
import { loadConfig, type Config } from './config.ts';
import { listWallets, openDb, type Wallet } from './db.ts';
import { getJson } from './http.ts';
import { fetchPositions } from './sources/zerion.ts';

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

// ── Binance ──────────────────────────────────────────────────────────────────

async function binanceSigned<T>(cfg: Config['binance'], path: string): Promise<T> {
  const query = `timestamp=${Date.now()}&recvWindow=10000`;
  const signature = createHmac('sha256', cfg.apiSecret).update(query).digest('hex');
  return getJson<T>(`https://api.binance.com${path}?${query}&signature=${signature}`, { 'X-MBX-APIKEY': cfg.apiKey });
}

async function checkBinance(cfg: Config['binance']): Promise<void> {
  // Public endpoints also show whether Binance blocks this machine's region.
  await step('Binance pub', async () => {
    await getJson('https://api.binance.com/api/v3/ping');
    await getJson('https://fapi.binance.com/fapi/v1/ping');
    report('ok', 'Binance pub', 'spot and futures APIs are reachable from this IP');
  });

  if (!cfg.apiKey || !cfg.apiSecret) return report('skip', 'Binance', 'key is not set');

  await step('Binance', async () => {
    const r = await binanceSigned<Record<string, unknown>>(cfg, '/sapi/v1/account/apiRestrictions');
    const dangerous = Object.entries(r)
      .filter(([k, v]) => v === true && k !== 'enableReading' && k !== 'ipRestrict')
      .map(([k]) => k);
    if (dangerous.length > 0) {
      report('fail', 'Binance', `key is not read-only, disable: ${dangerous.join(', ')}`);
    } else if (r.ipRestrict !== true) {
      report('warn', 'Binance', 'key is read-only but not restricted to trusted IPs');
    } else {
      report('ok', 'Binance', 'key is read-only and IP-restricted');
    }

    const acc = await binanceSigned<{ balances: { free: string; locked: string }[] }>(cfg, '/api/v3/account');
    const nonZero = acc.balances.filter((b) => Number(b.free) + Number(b.locked) > 0).length;
    report('ok', 'Binance', `spot account is readable, non-zero assets: ${nonZero}`);
  });
}

// ── Zerion (EVM + Solana) ────────────────────────────────────────────────────

async function checkZerion(cfg: Config['zerion'], wallets: Wallet[]): Promise<void> {
  if (!cfg.apiKey) return report('skip', 'Zerion', 'key is not set');
  if (wallets.length === 0) return report('skip', 'Zerion', 'no EVM or Solana wallets');

  for (const w of wallets) {
    await step('Zerion', async () => {
      const positions = await fetchPositions(cfg.apiKey, w.address, w.kind as 'evm' | 'solana');
      const total = positions.reduce((s, p) => s + (p.value ?? 0), 0);
      const byProtocol = new Map<string, number>();
      for (const p of positions) {
        if (p.protocol) byProtocol.set(p.protocol, (byProtocol.get(p.protocol) ?? 0) + (p.value ?? 0));
      }
      const protocols = [...byProtocol]
        .filter(([, v]) => Math.abs(v) >= 1)
        .sort((a, b) => b[1] - a[1])
        .map(([name, v]) => `${name} ${usd(v)}`);
      report(
        'ok',
        'Zerion',
        `${w.label} ${short(w.address)}: total ${usd(total)}, positions ${positions.length}` +
          (protocols.length > 0 ? `, protocols: ${protocols.join(', ')}` : ''),
      );
    });
  }
}

// ── TonAPI ───────────────────────────────────────────────────────────────────

async function checkTon(cfg: Config['tonapi'], ton: Wallet[]): Promise<void> {
  if (ton.length === 0) return report('skip', 'TonAPI', 'no TON wallets');
  // TonAPI also answers without a key, but with a tight rate limit; scheduled collection needs the key.
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

// ── CoinGecko, Fear & Greed ──────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  console.error(errText(err));
  process.exit(1);
}

const db = openDb();
await checkBinance(config.binance);
await checkZerion(config.zerion, [...listWallets(db, 'evm'), ...listWallets(db, 'solana')]);
await checkTon(config.tonapi, listWallets(db, 'ton'));
await checkCoingecko(config.coingecko);
await checkFearGreed();

const count = (s: Status): number => results.filter((r) => r === s).length;
console.log(
  `\nResult: ${count('ok')} ok, ${count('warn')} warnings, ${count('fail')} failed, ${count('skip')} skipped`,
);
process.exit(count('fail') > 0 ? 1 : 0);
