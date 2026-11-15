// Stage 1: collects every account once and prints the portfolio.
// Run: npm run collect            collect, then print
//      npm run collect -- --show  print the stored portfolio without calling any API
import { createResolver, loadAssetRules } from './assets.ts';
import { runCollection } from './collector.ts';
import { loadConfig } from './config.ts';
import { currentState, openDb, type AccountState } from './db.ts';
import { buildPortfolio } from './portfolio.ts';

const DUST_USD = 1;

const usd = (n: number): string =>
  `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (n: number): string => n.toLocaleString('en-US', { maximumSignificantDigits: 6 });
const price = (n: number | null): string =>
  n === null ? '—' : `$${n.toLocaleString('en-US', { maximumSignificantDigits: 5 })}`;
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
const short = (a: string): string => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** Prints rows as a table; columns listed in `right` are right-aligned. */
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
  const { netWorth, assets } = buildPortfolio(states, createResolver(loadAssetRules()));
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

const db = openDb();
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
// A failed source is visible above and in the exit code, so a scheduled run can alert on it.
process.exit(states.some((s) => s.lastStatus !== 'ok') ? 1 : 0);
