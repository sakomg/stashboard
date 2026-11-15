// HTTP server: the dashboard page, its JSON API and the collection schedule.
// It has no login yet, so it listens on localhost only. Do not expose it before stage 4.
import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import { createResolver, loadAssetRules } from './assets.ts';
import { runCollection } from './collector.ts';
import { loadConfig } from './config.ts';
import { addWallet, latestSignals, listSnapshots, openDb, removeWallet, renameWallet } from './db.ts';
import { runSignals } from './signals.ts';
import { fearGreed } from './sources/feargreed.ts';
import { historyView, portfolioView } from './view.ts';

const config = loadConfig();
const db = openDb();
const resolve = createResolver(loadAssetRules());
const root = new URL('../', import.meta.url);

// Everything the page loads, served from this origin only. Paths are fixed: nothing is read by request path.
const STATIC: Record<string, { file: string; type: string; cache?: boolean }> = {
  '/': { file: 'public/index.html', type: 'text/html; charset=utf-8' },
  '/app.css': { file: 'public/app.css', type: 'text/css; charset=utf-8' },
  '/app.js': { file: 'public/app.js', type: 'text/javascript; charset=utf-8' },
  '/logo.svg': { file: 'assets/logo.svg', type: 'image/svg+xml' },
  '/vendor/echarts.js': {
    file: 'node_modules/echarts/dist/echarts.min.js',
    type: 'text/javascript; charset=utf-8',
    cache: true,
  },
  '/vendor/bricolage.woff2': {
    file: 'node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2',
    type: 'font/woff2',
    cache: true,
  },
};

const app = Fastify({ logger: { level: 'warn' } });

app.addHook('onSend', async (_request, reply) => {
  reply.header(
    'Content-Security-Policy',
    // The chart library styles its tooltip inline; scripts are restricted to this origin.
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('X-Robots-Tag', 'noindex');
});

for (const [path, { file, type, cache }] of Object.entries(STATIC)) {
  app.get(path, async (_request, reply) => {
    reply.type(type).header('Cache-Control', cache ? 'public, max-age=86400' : 'no-cache');
    return readFileSync(new URL(file, root));
  });
}

// ── Collection ───────────────────────────────────────────────────────────────

let collecting: Promise<void> | null = null;

/** Signals are recomputed when they are older than the schedule allows. */
async function refreshSignals(): Promise<void> {
  const newest = latestSignals(db).reduce((max, s) => (s.time > max ? s.time : max), '');
  if (newest && Date.now() - Date.parse(newest) < config.schedule.signalsMinutes * 60_000) return;
  await runSignals(db, config, resolve);
}

/** Starts a collection unless one is already running; either way resolves when it has finished. */
function collect(): Promise<void> {
  collecting ??= runCollection(db, config)
    .then(refreshSignals)
    .catch((err: unknown) => app.log.error(err))
    .finally(() => {
      collecting = null;
    });
  return collecting;
}

const intervalMs = Math.max(config.schedule.balancesMinutes, 5) * 60_000;
setInterval(collect, intervalMs).unref();
const lastSnapshot = listSnapshots(db).at(-1);
if (!lastSnapshot || Date.now() - Date.parse(lastSnapshot.startedAt) > intervalMs) void collect();
else void refreshSignals().catch((err: unknown) => app.log.error(err));

// ── API ──────────────────────────────────────────────────────────────────────

app.get('/api/portfolio', async () => ({
  ...portfolioView(db, resolve),
  fearGreed: await fearGreed(),
  collecting: collecting !== null,
  collectEveryMinutes: intervalMs / 60_000,
}));

app.get<{ Querystring: { days?: string } }>('/api/history', async (request) => {
  const days = Number(request.query.days);
  return historyView(db, resolve, Number.isFinite(days) && days > 0 ? days : null);
});

app.post('/api/collect', async () => {
  await collect();
  return { ok: true };
});

app.post<{ Body: { address?: unknown; label?: unknown } }>('/api/wallets', async (request, reply) => {
  const { address, label } = request.body ?? {};
  if (typeof address !== 'string' || address.trim() === '')
    return reply.code(400).send({ error: 'Enter a wallet address' });
  try {
    const wallet = addWallet(db, address, typeof label === 'string' ? label.slice(0, 40) : undefined);
    return { id: wallet.id, kind: wallet.kind, label: wallet.label };
  } catch (err) {
    return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.patch<{ Params: { id: string }; Body: { label?: unknown } }>('/api/wallets/:id', async (request, reply) => {
  const label = typeof request.body?.label === 'string' ? request.body.label.trim().slice(0, 40) : '';
  if (!label) return reply.code(400).send({ error: 'Enter a name for the wallet' });
  if (!renameWallet(db, Number(request.params.id), label)) return reply.code(404).send({ error: 'No such wallet' });
  return { ok: true };
});

app.delete<{ Params: { id: string } }>('/api/wallets/:id', async (request, reply) => {
  if (!removeWallet(db, Number(request.params.id))) return reply.code(404).send({ error: 'No such wallet' });
  return { ok: true };
});

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8787);
await app.listen({ host, port });
console.log(`Stashboard is running at http://${host}:${port}`);
