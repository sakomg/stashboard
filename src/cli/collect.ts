import { createResolver, loadAssetRules } from '../domain/assets.ts';
import { loadLearned } from '../services/categories.ts';
import { runCollection } from '../services/collector.ts';
import { importConfigExchange } from '../services/exchanges.ts';
import { loadConfig } from '../lib/config.ts';
import { currentState, openDb, type AccountState } from '../storage/index.ts';
import { buildPortfolio } from '../domain/portfolio.ts';
import { runSignals } from '../services/signals.ts';

const DUST_USD = 1;

const usd = (n: number): string =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (n: number): string => n.toLocaleString('en-US', { maximumSignificantDigits: 6 });
const price = (n: number | null): string =>
  n === null ? '—' : `$${n.toLocaleString('en-US', { maximumSignificantDigits: 5 })}`;
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
const short = (a: string): string => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

function table(header: string[], rows: string[][], right: number[]): void {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]): string =>
    cells.map((c, i) => (right.includes(i) ? c.padStart(widths[i]!) : c.padEnd(widths[i]!))).join('  ');
  console.log(line(header));
  console.log(widths.map((w) => '─'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(r));
}

function printSources(states: AccountState[]): void {
  console.log('Sources');
  const notes: string[] = [];
  const rows = states.map((s) => {
    const total = s.holdings.reduce((sum, h) => sum + h.value, 0);
    const own: string[] = [];
    if (s.lastStatus === null) own.push('never collected');
    if (s.stale) {
      own.push(`FAILED: ${s.lastError}`);
      own.push(s.collectedAt ? `showing data from ${s.collectedAt}` : 'no earlier data to show');
    }
    if (s.reportedTotal !== null) {
      const diff = s.reportedTotal !== 0 ? (total - s.reportedTotal) / s.reportedTotal : 0;
      own.push(`the source itself reports ${usd(s.reportedTotal)}, difference ${(diff * 100).toFixed(2)}%`);
    }
    own.push(...s.warnings);
    notes.push(...own.map((n) => `  ${s.account.label}: ${n}`));
    const mark = s.lastStatus === 'ok' ? '✓' : s.lastStatus === 'error' ? '✗' : '–';
    return [mark, s.account.label, s.account.kind, short(s.account.address), usd(total)];
  });
  table(['', 'Account', 'Kind', 'Address', 'Value'], rows, [4]);
  for (const n of notes) console.log(n);
}

function printAssets(states: AccountState[]): void {
  const { netWorth, assets } = buildPortfolio(states, createResolver(loadAssetRules(), loadLearned(db)));
  const shown = assets.filter((a) => Math.abs(a.value) >= DUST_USD);
  const dust = assets.filter((a) => Math.abs(a.value) < DUST_USD);

  console.log('\nAssets');
  const rows = shown.map((a) => [a.key, a.category, qty(a.quantity), price(a.price), usd(a.value), pct(a.share)]);
  if (dust.length > 0) {
    const value = dust.reduce((s, a) => s + a.value, 0);
    rows.push([
      `Dust (${dust.length} under $${DUST_USD})`,
      '',
      '',
      '',
      usd(value),
      pct(netWorth ? value / netWorth : 0),
    ]);
  }
  table(['Asset', 'Category', 'Quantity', 'Price', 'Value', 'Share'], rows, [2, 3, 4, 5]);

  const byCategory = new Map<string, number>();
  for (const a of assets) byCategory.set(a.category, (byCategory.get(a.category) ?? 0) + a.value);
  console.log('\nCategories');
  table(
    ['Category', 'Value', 'Share'],
    [...byCategory].sort((a, b) => b[1] - a[1]).map(([name, v]) => [name, usd(v), pct(netWorth ? v / netWorth : 0)]),
    [1, 2],
  );

  console.log(`\nNet worth: ${usd(netWorth)}`);
}

const READING_LABELS = {
  rsiDaily: 'RSI 1d',
  rsiWeekly: 'RSI 1w',
  funding: 'Funding %/8h',
  ma200: 'vs 200d %',
  oiGrowth: 'OI 7d %',
} as const;

async function printSignals(db: ReturnType<typeof openDb>): Promise<void> {
  const rows = await runSignals(db, loadConfig(), createResolver(loadAssetRules(), loadLearned(db)));
  const names = Object.keys(READING_LABELS) as (keyof typeof READING_LABELS)[];
  console.log('Signals');
  table(
    ['Asset', 'Market', 'Heat', 'Zone', ...names.map((n) => READING_LABELS[n])],
    rows
      .sort((a, b) => b.score - a.score)
      .map((r) => [
        r.asset,
        r.pair,
        r.score.toFixed(0),
        r.zone,
        ...names.map((n) => {
          const c = r.components.find((x) => x.name === n);
          return c ? c.value.toFixed(n === 'funding' ? 4 : 1) : '—';
        }),
      ]),
    [2, 4, 5, 6, 7, 8],
  );
}

const db = openDb();
importConfigExchange(db, loadConfig().binance);
if (process.argv.includes('--signals')) {
  await printSignals(db);
  process.exit(0);
}
if (!process.argv.includes('--show')) {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  await runCollection(db, config);
}

const states = currentState(db);
if (states.length === 0) {
  console.log(
    'Nothing to collect: set the Binance key in config.json or add a wallet with npm run wallets -- add <address>',
  );
  process.exit(1);
}
printSources(states);
printAssets(states);
process.exit(states.some((s) => s.lastStatus !== 'ok') ? 1 : 0);
