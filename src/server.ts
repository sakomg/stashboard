// HTTP server: the dashboard page, its JSON API, login and the collection schedule.
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { createResolver, loadAssetRules } from './assets.ts';
import { AttemptLimiter, matchTotp, verifyPassword } from './auth.ts';
import { runCollection } from './collector.ts';
import { loadConfig } from './config.ts';
import {
  addWallet,
  backupDaily,
  createSession,
  deleteSession,
  latestSignals,
  listSnapshots,
  openDb,
  removeWallet,
  renameWallet,
  sessionValid,
} from './db.ts';
import { runSignals } from './signals.ts';
import { fearGreed } from './sources/feargreed.ts';
import { historyView, portfolioView } from './view.ts';

const config = loadConfig();
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8787);

// Without a login the dashboard must not be reachable from anywhere but this machine.
if (!config.auth && !['127.0.0.1', 'localhost', '::1'].includes(host)) {
  console.error(`Refusing to listen on ${host} without a login. Run npm run auth first, or listen on 127.0.0.1.`);
  process.exit(1);
}

const db = openDb();
const resolve = createResolver(loadAssetRules());
const root = new URL('../', import.meta.url);

// Everything the pages load, served from this origin only. Paths are fixed: nothing is read by request path.
const STATIC: Record<string, { file: string; type: string; cache?: boolean; open?: boolean }> = {
  '/': { file: 'public/index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'public/app.js', type: 'text/javascript; charset=utf-8' },
  '/vendor/echarts.js': {
    file: 'node_modules/echarts/dist/echarts.min.js',
    type: 'text/javascript; charset=utf-8',
    cache: true,
  },
  // The login page and what it needs are the only files served without a session.
  '/login': { file: 'public/login.html', type: 'text/html; charset=utf-8', open: true },
  '/login.js': { file: 'public/login.js', type: 'text/javascript; charset=utf-8', open: true },
  '/app.css': { file: 'public/app.css', type: 'text/css; charset=utf-8', open: true },
  '/logo.svg': { file: 'assets/logo.svg', type: 'image/svg+xml', open: true },
  '/vendor/bricolage.woff2': {
    file: 'node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2',
    type: 'font/woff2',
    cache: true,
    open: true,
  },
};
const OPEN_PATHS = new Set(['/healthz', '/api/login', ...Object.keys(STATIC).filter((p) => STATIC[p]!.open)]);

// Behind the reverse proxy the client address and protocol come from its forwarding headers.
const app = Fastify({ logger: { level: 'warn' }, trustProxy: process.env.TRUST_PROXY === '1' });

// ── Sessions ─────────────────────────────────────────────────────────────────

const COOKIE = 'stashboard_session';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function sessionToken(request: FastifyRequest): string | null {
  const match = new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]+)`).exec(request.headers.cookie ?? '');
  return match ? match[1]! : null;
}

function setSessionCookie(request: FastifyRequest, reply: FastifyReply, token: string, maxAgeSeconds: number): void {
  const secure = request.protocol === 'https' ? '; Secure' : '';
  reply.header(
    'Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`,
  );
}

app.addHook('onRequest', async (request, reply) => {
  const path = request.url.split('?')[0]!;

  // A page on another site must not be able to change anything here, even with the user's cookie.
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const origin = request.headers.origin;
    if (origin && new URL(origin).host !== request.headers.host)
      return reply.code(403).send({ error: 'Cross-site request refused' });
  }

  if (!config.auth || OPEN_PATHS.has(path)) return;
  const token = sessionToken(request);
  if (token && sessionValid(db, token)) return;
  if (path.startsWith('/api/')) return reply.code(401).send({ error: 'Sign in to continue' });
  return reply.redirect('/login');
});

app.addHook('onSend', async (request, reply) => {
  reply.header(
    'Content-Security-Policy',
    // The chart library styles its tooltip inline; scripts are restricted to this origin.
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  );
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('X-Robots-Tag', 'noindex');
  if (request.protocol === 'https') reply.header('Strict-Transport-Security', 'max-age=31536000');
});

for (const [path, { file, type, cache }] of Object.entries(STATIC)) {
  app.get(path, async (_request, reply) => {
    reply.type(type).header('Cache-Control', cache ? 'public, max-age=86400' : 'no-cache');
    return readFileSync(new URL(file, root));
  });
}

app.get('/healthz', async () => ({ ok: true }));

// ── Login ────────────────────────────────────────────────────────────────────

// Five wrong attempts from one address lock it out for 15 minutes. The global limit caps guessing
// spread over many addresses; it is high enough that the owner mistyping never trips it.
const perAddress = new AttemptLimiter(5, 15 * 60_000);
const everyone = new AttemptLimiter(50, 15 * 60_000);
let lastTotpStep = 0;

app.post<{ Body: { password?: unknown; code?: unknown } }>('/api/login', async (request, reply) => {
  if (!config.auth) return { ok: true };

  const wait = Math.max(perAddress.retryAfter(request.ip), everyone.retryAfter('all'));
  if (wait > 0) {
    return reply
      .code(429)
      .header('Retry-After', wait)
      .send({ error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.` });
  }

  const { password, code } = request.body ?? {};
  // Both checks always run, and the answer does not say which one failed.
  const passwordOk = typeof password === 'string' && verifyPassword(password, config.auth.passwordHash);
  const step = typeof code === 'string' ? matchTotp(config.auth.totpSecret, code) : null;
  // A code is accepted once: a step at or before the last accepted one is a replay.
  if (!passwordOk || step === null || step <= lastTotpStep) {
    perAddress.fail(request.ip);
    everyone.fail('all');
    app.log.warn({ ip: request.ip }, 'failed sign-in');
    return reply.code(401).send({ error: 'Wrong password or code' });
  }

  lastTotpStep = step;
  perAddress.clear(request.ip);
  setSessionCookie(request, reply, createSession(db, SESSION_MS), SESSION_MS / 1000);
  return { ok: true };
});

app.post('/api/logout', async (request, reply) => {
  const token = sessionToken(request);
  if (token) deleteSession(db, token);
  setSessionCookie(request, reply, '', 0);
  return { ok: true };
});

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

// One copy of the database a day, taken at start and then checked hourly.
const backup = (): void => {
  try {
    const file = backupDaily(db);
    if (file) console.log(`Database backed up to ${file}`);
  } catch (err) {
    app.log.error(err);
  }
};
backup();
setInterval(backup, 60 * 60_000).unref();

// ── API ──────────────────────────────────────────────────────────────────────

app.get('/api/portfolio', async () => ({
  ...portfolioView(db, resolve),
  fearGreed: await fearGreed(),
  collecting: collecting !== null,
  collectEveryMinutes: intervalMs / 60_000,
  loginEnabled: config.auth !== null,
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

await app.listen({ host, port });
console.log(
  `Stashboard is running at http://${host}:${port}${config.auth ? '' : ' (no login configured: local use only)'}`,
);

// Docker stops the container with SIGTERM; close cleanly so the database is not cut off mid-write.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void app.close().then(() => {
      db.close();
      process.exit(0);
    });
  });
}
