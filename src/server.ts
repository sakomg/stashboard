// HTTP server: the dashboard page, its JSON API, first-run setup, login and the collection schedule.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { createResolver, loadAssetRules } from './assets.ts';
import {
  AttemptLimiter,
  base32Encode,
  hashPassword,
  matchTotp,
  newTotpSecret,
  otpauthUri,
  verifyPassword,
} from './auth.ts';
import { runCollection } from './collector.ts';
import { loadConfig } from './config.ts';
import {
  addWallet,
  backupDaily,
  createSession,
  deleteSession,
  getOwner,
  latestSignals,
  listSnapshots,
  openDb,
  removeWallet,
  renameWallet,
  saveOwner,
  sessionValid,
} from './db.ts';
import { qrSvg } from './qr.ts';
import { runSignals } from './signals.ts';
import { fearGreed } from './sources/feargreed.ts';
import { historyView, portfolioView, wantedLogos } from './view.ts';
import { fetchMissingLogos, logoFile, noteLogos } from './logos.ts';
import { fetchChains } from './sources/zerion.ts';

const config = loadConfig();
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8787);
const db = openDb();
const resolve = createResolver(loadAssetRules());
const root = new URL('../', import.meta.url);

// ── Who may see what ─────────────────────────────────────────────────────────
// With an account: everything needs a session. Without one, a server reachable from other machines
// serves only the setup page, and creating the account needs the setup code printed in the server log,
// so a stranger who finds the address first cannot claim it. On localhost alone the dashboard is open.

let owner = getOwner(db);
const local = ['127.0.0.1', 'localhost', '::1'].includes(host) && process.env.REQUIRE_LOGIN !== '1';
// Grouped like the authenticator key, without look-alike characters; about 60 bits.
const setupCode = owner ? null : base32Encode(randomBytes(8)).slice(0, 12);
const formatCode = (code: string): string => code.match(/.{4}/g)!.join('-');

// Everything the pages load, served from this origin only. Paths are fixed: nothing is read by request path.
type Access = 'session' | 'signin' | 'setup';
const STATIC: Record<string, { file: string; type: string; cache?: boolean; access: Access[] }> = {
  '/': { file: 'public/index.html', type: 'text/html; charset=utf-8', access: ['session'] },
  '/app.js': { file: 'public/app.js', type: 'text/javascript; charset=utf-8', access: ['session'] },
  '/vendor/echarts.js': {
    file: 'node_modules/echarts/dist/echarts.min.js',
    type: 'text/javascript; charset=utf-8',
    cache: true,
    access: ['session'],
  },
  '/login': { file: 'public/login.html', type: 'text/html; charset=utf-8', access: ['signin'] },
  '/login.js': { file: 'public/login.js', type: 'text/javascript; charset=utf-8', access: ['signin'] },
  '/setup': { file: 'public/setup.html', type: 'text/html; charset=utf-8', access: ['setup'] },
  '/setup.js': { file: 'public/setup.js', type: 'text/javascript; charset=utf-8', access: ['setup'] },
  '/app.css': { file: 'public/app.css', type: 'text/css; charset=utf-8', access: ['signin', 'setup'] },
  '/logo.svg': { file: 'assets/logo.svg', type: 'image/svg+xml', access: ['signin', 'setup'] },
  '/vendor/bricolage.woff2': {
    file: 'node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2',
    type: 'font/woff2',
    cache: true,
    access: ['signin', 'setup'],
  },
};
const openTo = (access: Access): Set<string> =>
  new Set(Object.keys(STATIC).filter((path) => STATIC[path]!.access.includes(access)));
const SIGNIN_PATHS = new Set([...openTo('signin'), '/healthz', '/icons.svg', '/api/login']);
const SETUP_PATHS = new Set([...openTo('setup'), '/healthz', '/icons.svg', '/api/setup/start', '/api/setup/finish']);

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
  const api = path.startsWith('/api/');

  // A page on another site must not be able to change anything here, even with the user's cookie.
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const origin = request.headers.origin;
    if (origin && new URL(origin).host !== request.headers.host) {
      return reply.code(403).send({ error: 'Cross-site request refused' });
    }
  }

  if (owner) {
    // Setup is over: its pages lead to sign-in, its API is closed.
    if (path === '/setup') return reply.redirect('/login');
    if (SIGNIN_PATHS.has(path)) return;
    const token = sessionToken(request);
    if (token && sessionValid(db, token)) return;
    return api ? reply.code(401).send({ error: 'Sign in to continue' }) : reply.redirect('/login');
  }

  if (path === '/login') return reply.redirect('/setup');
  if (local || SETUP_PATHS.has(path)) return;
  return api ? reply.code(401).send({ error: 'Create the account first' }) : reply.redirect('/setup');
});

app.addHook('onSend', async (request, reply) => {
  if (!reply.hasHeader('Content-Security-Policy'))
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

// ── Icons and logos ──────────────────────────────────────────────────────────

// Interface icons: one sprite built from the Lucide set, holding only the icons the pages use.
const ICONS = [
  'refresh-cw',
  'plus',
  'log-out',
  'pencil',
  'trash-2',
  'check',
  'x',
  'chevron-right',
  'arrow-up',
  'arrow-down',
  'triangle-alert',
  'clock',
  'wallet',
];
const sprite =
  '<svg xmlns="http://www.w3.org/2000/svg">' +
  ICONS.map((name) => {
    const svg = readFileSync(new URL(`node_modules/lucide-static/icons/${name}.svg`, root), 'utf8');
    const body = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>'));
    return `<symbol id="${name}" viewBox="0 0 24 24">${body.trim()}</symbol>`;
  }).join('') +
  '</svg>';

app.get('/icons.svg', async (_request, reply) => {
  reply.type('image/svg+xml').header('Cache-Control', 'public, max-age=86400');
  return sprite;
});

app.get<{ Params: { kind: string; key: string } }>('/logo/:kind/:key', async (request, reply) => {
  const logo = logoFile(db, request.params.kind, request.params.key);
  if (!logo) return reply.code(404).header('Cache-Control', 'no-store').send({ error: 'No logo' });
  // Logos come from third parties. Sandboxing means that even an SVG opened directly cannot run anything here.
  reply.header('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
  reply.type(logo.type).header('Cache-Control', 'private, max-age=604800');
  return readFileSync(logo.path);
});

// ── Attempt limiting, shared by setup and sign-in ────────────────────────────

// Five wrong attempts from one address lock it out for 15 minutes. The global limit caps guessing
// spread over many addresses; it is high enough that the owner mistyping never trips it.
const perAddress = new AttemptLimiter(5, 15 * 60_000);
const everyone = new AttemptLimiter(50, 15 * 60_000);
let lastTotpStep = 0;

/** Sends the lockout answer and returns true when this address has to wait. */
function lockedOut(request: FastifyRequest, reply: FastifyReply): boolean {
  const wait = Math.max(perAddress.retryAfter(request.ip), everyone.retryAfter('all'));
  if (wait === 0) return false;
  void reply
    .code(429)
    .header('Retry-After', wait)
    .send({ error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.` });
  return true;
}

function failed(request: FastifyRequest, what: string): void {
  perAddress.fail(request.ip);
  everyone.fail('all');
  app.log.warn({ ip: request.ip }, what);
}

function signIn(request: FastifyRequest, reply: FastifyReply, step: number): void {
  lastTotpStep = step;
  perAddress.clear(request.ip);
  setSessionCookie(request, reply, createSession(db, SESSION_MS), SESSION_MS / 1000);
}

// ── First-run setup ──────────────────────────────────────────────────────────

const MIN_PASSWORD = 12;
const PENDING_MS = 15 * 60_000;
// The password and authenticator secret chosen in step one, kept in memory until a code proves
// the authenticator works. Nothing is saved before that.
let pending: { passwordHash: string; totpSecret: string; at: number } | null = null;

function setupCodeMatches(given: unknown): boolean {
  if (!setupCode || typeof given !== 'string') return false;
  const normalised = Buffer.from(
    given
      .toUpperCase()
      .replace(/[^A-Z2-7]/g, '')
      .padEnd(setupCode.length)
      .slice(0, setupCode.length),
  );
  return timingSafeEqual(normalised, Buffer.from(setupCode));
}

app.post<{ Body: { setupCode?: unknown; password?: unknown } }>('/api/setup/start', async (request, reply) => {
  if (owner) return reply.code(409).send({ error: 'The account already exists. Sign in instead.' });
  if (lockedOut(request, reply)) return reply;
  const { password } = request.body ?? {};
  if (!setupCodeMatches(request.body?.setupCode)) {
    failed(request, 'wrong setup code');
    return reply
      .code(401)
      .send({ error: 'That setup code is not right. It is printed in the server log each time the server starts.' });
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    return reply.code(400).send({ error: `Use a password of at least ${MIN_PASSWORD} characters.` });
  }

  const totpSecret = newTotpSecret();
  pending = { passwordHash: hashPassword(password), totpSecret, at: Date.now() };
  return {
    key: totpSecret.match(/.{1,4}/g)!.join(' '),
    qr: qrSvg(otpauthUri(totpSecret, config.domain || 'dashboard')),
  };
});

app.post<{ Body: { setupCode?: unknown; code?: unknown } }>('/api/setup/finish', async (request, reply) => {
  if (owner) return reply.code(409).send({ error: 'The account already exists. Sign in instead.' });
  if (lockedOut(request, reply)) return reply;
  if (!setupCodeMatches(request.body?.setupCode)) {
    failed(request, 'wrong setup code');
    return reply.code(401).send({ error: 'That setup code is not right.' });
  }
  if (!pending || Date.now() - pending.at > PENDING_MS) {
    pending = null;
    return reply.code(400).send({ error: 'Setup took too long and was reset. Start again.' });
  }
  const code = request.body?.code;
  const step = typeof code === 'string' ? matchTotp(pending.totpSecret, code) : null;
  if (step === null) {
    failed(request, 'wrong authenticator code during setup');
    return reply
      .code(401)
      .send({ error: 'That code does not match. Check the app shows this account and try the next code.' });
  }

  owner = { passwordHash: pending.passwordHash, totpSecret: pending.totpSecret };
  saveOwner(db, owner);
  pending = null;
  signIn(request, reply, step);
  console.log('Account created. Setup is closed; sign-in is now required.');
  return { ok: true };
});

// ── Sign-in ──────────────────────────────────────────────────────────────────

app.post<{ Body: { password?: unknown; code?: unknown } }>('/api/login', async (request, reply) => {
  if (!owner) return reply.code(409).send({ error: 'There is no account yet. Create it first.' });
  if (lockedOut(request, reply)) return reply;

  const { password, code } = request.body ?? {};
  // Both checks always run, and the answer does not say which one failed.
  const passwordOk = typeof password === 'string' && verifyPassword(password, owner.passwordHash);
  const step = typeof code === 'string' ? matchTotp(owner.totpSecret, code) : null;
  // A code is accepted once: a step at or before the last accepted one is a replay.
  if (!passwordOk || step === null || step <= lastTotpStep) {
    failed(request, 'failed sign-in');
    return reply.code(401).send({ error: 'Wrong password or code' });
  }
  signIn(request, reply, step);
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

let chainsFetchedAt = 0;

/** Fetches the logos the portfolio shows and does not have yet. Cosmetic, so a failure is only logged. */
async function refreshLogos(): Promise<void> {
  try {
    if (config.zerion.apiKey && Date.now() - chainsFetchedAt > 24 * 60 * 60_000) {
      noteLogos(db, await fetchChains(config.zerion.apiKey));
      chainsFetchedAt = Date.now();
    }
    await fetchMissingLogos(db, config, wantedLogos(db, resolve));
  } catch (err) {
    app.log.warn(err);
  }
}

/** Starts a collection unless one is already running; either way resolves when it has finished. */
function collect(): Promise<void> {
  collecting ??= runCollection(db, config)
    .then(refreshSignals)
    .then(() => {
      // Logos are cosmetic: fetched in the background so they never hold up an update.
      void refreshLogos();
    })
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
else
  void refreshSignals()
    .then(refreshLogos)
    .catch((err: unknown) => app.log.error(err));

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
  loginEnabled: owner !== null,
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
console.log(`Stashboard is running at http://${host}:${port}`);
if (setupCode) {
  const where = config.domain && !local ? `https://${config.domain}/setup` : `http://${host}:${port}/setup`;
  // The marker lets the deploy script find this line in the log.
  console.log(`No account yet. Create one at ${where} with this setup code: ${formatCode(setupCode)}  [setup-code]`);
  if (local) console.log('Until then the dashboard is open on this machine only.');
}

// Docker stops the container with SIGTERM; close cleanly so the database is not cut off mid-write.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void app.close().then(() => {
      db.close();
      process.exit(0);
    });
  });
}
