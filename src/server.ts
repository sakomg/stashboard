import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
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
import { categoryNames, fetchMissingCategories, loadLearned, setManualCategory } from './categories.ts';
import { runCollection, updateGate, type ProgressEvent } from './collector.ts';
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
  backupNow,
  removeAccount,
  renameAccount,
  resetHistory,
  saveOwner,
  sessionValid,
  getSetting,
  listWallets,
  setSetting,
} from './db.ts';
import { qrSvg } from './qr.ts';
import { runSignals } from './signals.ts';
import { fearGreed } from './sources/feargreed.ts';
import { historyView, portfolioView, wantedLogos } from './view.ts';
import { fetchMissingLogos, logoFile, noteLogos } from './logos.ts';
import { fetchChains, zerionDayUsedUp, zerionQuota } from './sources/zerion.ts';
import { addExchange, checkBinanceKey, EXCHANGES, importConfigExchange, type ExchangeKind } from './exchanges.ts';
import { createShare, deleteShare, getShare, listShares, parseSharePayload, shareHasLogo } from './shares.ts';

const config = loadConfig();
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8787);
const db = openDb();
const demo = process.env.DEMO === '1';
if (!demo) importConfigExchange(db, config.binance);
const rules = loadAssetRules();
const categories = categoryNames(rules);
const learned = loadLearned(db);
const resolve = createResolver(rules, learned);
const root = new URL('../', import.meta.url);

let owner = getOwner(db);
const local = ['127.0.0.1', 'localhost', '::1'].includes(host) && process.env.REQUIRE_LOGIN !== '1';
const setupCode = owner ? null : base32Encode(randomBytes(8)).slice(0, 12);
const formatCode = (code: string): string => code.match(/.{4}/g)!.join('-');

type Access = 'session' | 'signin' | 'setup' | 'public';
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
  '/ui.js': { file: 'public/ui.js', type: 'text/javascript; charset=utf-8', access: ['session', 'public'] },
  '/share.js': { file: 'public/share.js', type: 'text/javascript; charset=utf-8', access: ['public'] },
  '/app.css': { file: 'public/app.css', type: 'text/css; charset=utf-8', access: ['signin', 'setup', 'public'] },
  '/logo.svg': { file: 'assets/logo.svg', type: 'image/svg+xml', access: ['signin', 'setup', 'public'] },
  '/vendor/bricolage.woff2': {
    file: 'node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2',
    type: 'font/woff2',
    cache: true,
    access: ['signin', 'setup', 'public'],
  },
};
const openTo = (access: Access): Set<string> =>
  new Set(Object.keys(STATIC).filter((path) => STATIC[path]!.access.includes(access)));
const SIGNIN_PATHS = new Set([...openTo('signin'), '/healthz', '/icons.svg', '/api/login']);
const SETUP_PATHS = new Set([...openTo('setup'), '/healthz', '/icons.svg', '/api/setup/start', '/api/setup/finish']);
const PUBLIC_PATHS = new Set([...openTo('public'), '/icons.svg']);
const isPublic = (path: string): boolean =>
  PUBLIC_PATHS.has(path) ||
  /^\/s\/[A-Za-z0-9_-]+(\/logo\/[a-z]+\/[^/]+)?$/.test(path) ||
  /^\/api\/shared\/[A-Za-z0-9_-]+$/.test(path);

const app = Fastify({ logger: { level: 'warn' }, trustProxy: process.env.TRUST_PROXY === '1' });

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
  if (demo && DEMO_LOCKED.test(`${request.method} ${request.url.split('?')[0]}`)) {
    return reply.code(403).send({ error: 'This is the demo. Install Stashboard to add your own accounts.' });
  }
  const path = request.url.split('?')[0]!;
  const api = path.startsWith('/api/');

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const origin = request.headers.origin;
    if (origin && new URL(origin).host !== request.headers.host) {
      return reply.code(403).send({ error: 'Cross-site request refused' });
    }
  }

  if (request.method === 'GET' && isPublic(path)) return;

  if (owner) {
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

const ICONS = [
  'chevron-down',
  'circle-help',
  'external-link',
  'circle-user',
  'settings',
  'landmark',
  'eye',
  'eye-off',
  'share-2',
  'download',
  'copy',
  'link',
  'image',
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

const spriteTag = `"${createHash('sha1').update(sprite).digest('hex').slice(0, 16)}"`;

app.get('/icons.svg', async (request, reply) => {
  reply.header('Cache-Control', 'no-cache').header('ETag', spriteTag);
  if (request.headers['if-none-match'] === spriteTag) return reply.code(304).send();
  return reply.type('image/svg+xml').send(sprite);
});

app.get<{ Params: { kind: string; key: string } }>('/logo/:kind/:key', async (request, reply) => {
  const logo = logoFile(db, request.params.kind, request.params.key);
  if (!logo) return reply.code(404).header('Cache-Control', 'no-store').send({ error: 'No logo' });
  reply.header('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
  reply.type(logo.type).header('Cache-Control', 'private, max-age=604800');
  return readFileSync(logo.path);
});

app.get<{ Params: { token: string } }>('/s/:token', async (_request, reply) => {
  reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store');
  return readFileSync(new URL('public/share.html', root));
});

app.get<{ Params: { token: string } }>('/api/shared/:token', async (request, reply) => {
  const share = getShare(db, request.params.token);
  reply.header('Cache-Control', 'no-store');
  if (!share) return reply.code(404).send({ error: 'This link has expired or was turned off.' });
  return { ...share.payload, expiresAt: share.expiresAt };
});

app.get<{ Params: { token: string; kind: string; key: string } }>(
  '/s/:token/logo/:kind/:key',
  async (request, reply) => {
    const { token, kind, key } = request.params;
    const share = getShare(db, token);
    const logo = share && shareHasLogo(share, kind, key) ? logoFile(db, kind, key) : null;
    if (!logo) return reply.code(404).header('Cache-Control', 'no-store').send({ error: 'No logo' });
    reply.header('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
    reply.type(logo.type).header('Cache-Control', 'private, max-age=86400');
    return readFileSync(logo.path);
  },
);

const perAddress = new AttemptLimiter(5, 15 * 60_000);
const everyone = new AttemptLimiter(50, 15 * 60_000);
let lastTotpStep = 0;

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

const MIN_PASSWORD = 12;
const PENDING_MS = 15 * 60_000;
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
  console.log('Account created. Setup is closed and sign-in is now required.');
  return { ok: true };
});

app.post<{ Body: { password?: unknown; code?: unknown } }>('/api/login', async (request, reply) => {
  if (!owner) return reply.code(409).send({ error: 'There is no account yet. Create it first.' });
  if (lockedOut(request, reply)) return reply;

  const { password, code } = request.body ?? {};
  const passwordOk = typeof password === 'string' && verifyPassword(password, owner.passwordHash);
  const step = typeof code === 'string' ? matchTotp(owner.totpSecret, code) : null;
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

let collecting: Promise<void> | null = null;

interface Progress {
  phase: 'accounts' | 'signals';
  accounts: { id: number; state: 'waiting' | 'reading' | 'done' | 'failed'; note: string | null }[];
}
let progress: Progress | null = null;
let lastFinishedAt = 0;

const DEMO_LOCKED = /^(POST \/api\/(wallets|exchanges|history\/reset|collect)|DELETE \/api\/accounts\/)/;

const gate = () => {
  if (demo) return { allowed: false, reason: 'Demo data. Updates are off', availableAt: null };
  const q = zerionQuota();
  return updateGate({
    running: collecting !== null,
    lastFinishedAt,
    zerionWallets: listWallets(db, 'evm').length + listWallets(db, 'solana').length,
    zerionUsedUp: zerionDayUsedUp(),
    zerionRenewsAt: q.dayResetsAt,
  });
};

function track(event: ProgressEvent): void {
  if (event.type === 'start') {
    progress = {
      phase: 'accounts',
      accounts: event.accounts.map((a) => ({ id: a.id, state: 'waiting', note: null })),
    };
    return;
  }
  const entry = progress?.accounts.find((a) => a.id === event.accountId);
  if (!entry) return;
  if (event.type === 'reading') Object.assign(entry, { state: 'reading', note: null });
  else if (event.type === 'waiting') entry.note = event.note;
  else Object.assign(entry, { state: event.ok ? 'done' : 'failed', note: event.note ?? null });
}

async function refreshSignals(): Promise<void> {
  const newest = latestSignals(db).reduce((max, s) => (s.time > max ? s.time : max), '');
  if (newest && Date.now() - Date.parse(newest) < config.schedule.signalsMinutes * 60_000) return;
  await runSignals(db, config, resolve);
}

async function refreshCategories(): Promise<void> {
  try {
    if ((await fetchMissingCategories(db, config, resolve, categories)) > 0) loadLearned(db, learned);
  } catch (err) {
    app.log.warn(err);
  }
}

async function refreshLogos(): Promise<void> {
  try {
    const chainsAt = Number(getSetting(db, 'zerion_chains_at') ?? 0);
    if (config.zerion.apiKey && Date.now() - chainsAt > 7 * 24 * 60 * 60_000) {
      noteLogos(db, await fetchChains(config.zerion.apiKey));
      setSetting(db, 'zerion_chains_at', String(Date.now()));
    }
    await fetchMissingLogos(db, config, wantedLogos(db, resolve));
  } catch (err) {
    app.log.warn(err);
  }
}

function collect(): Promise<void> {
  collecting ??= runCollection(db, config, track)
    .then(() => {
      if (progress) progress.phase = 'signals';
      return refreshSignals();
    })
    .then(() => {
      void refreshLogos();
      void refreshCategories();
    })
    .catch((err: unknown) => app.log.error(err))
    .finally(() => {
      collecting = null;
      progress = null;
      lastFinishedAt = Date.now();
    });
  return collecting;
}

void fearGreed();

const intervalMs = Math.max(config.schedule.balancesMinutes, 5) * 60_000;
const lastSnapshot = listSnapshots(db).at(-1);
if (demo) void refreshLogos();
else {
  setInterval(collect, intervalMs).unref();
  if (!lastSnapshot || Date.now() - Date.parse(lastSnapshot.startedAt) > intervalMs) void collect();
  else
    void refreshSignals()
      .then(refreshLogos)
      .catch((err: unknown) => app.log.error(err));
}

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

const build = createHash('sha1')
  .update(
    ['public/index.html', 'public/app.js', 'public/app.css', 'public/ui.js']
      .map((f) => readFileSync(new URL(f, root)))
      .join(),
  )
  .digest('hex')
  .slice(0, 12);

app.get('/api/portfolio', async () => ({
  ...portfolioView(db, resolve),
  build,
  categories,
  progress,
  zerion: zerionQuota(),
  fearGreed: await fearGreed(),
  collecting: collecting !== null,
  update: gate(),
  demo,
  heat: { weights: config.heat.weights, zones: config.heat.zones },
  exchanges: EXCHANGES,
  preferences: { hideAmounts: getSetting(db, 'hide_amounts') === '1' },
  collectEveryMinutes: intervalMs / 60_000,
  loginEnabled: owner !== null,
}));

app.get('/api/progress', async () => ({ collecting: collecting !== null, progress, update: gate() }));

app.put<{ Body: { hideAmounts?: unknown } }>('/api/preferences', async (request, reply) => {
  const { hideAmounts } = request.body ?? {};
  if (typeof hideAmounts !== 'boolean') return reply.code(400).send({ error: 'hideAmounts must be true or false' });
  setSetting(db, 'hide_amounts', hideAmounts ? '1' : '0');
  return { hideAmounts };
});

app.get('/api/shares', async () =>
  listShares(db).map((s) => ({
    token: s.token,
    title: s.payload.title,
    withAmounts: s.payload.total !== null || s.payload.rows.some((r) => r.value !== null),
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
  })),
);

app.post('/api/shares', async (request, reply) => {
  const parsed = parseSharePayload(request.body);
  if ('error' in parsed) return reply.code(400).send({ error: parsed.error });
  const share = createShare(db, parsed.payload, parsed.days);
  return { token: share.token, expiresAt: share.expiresAt };
});

app.delete<{ Params: { token: string } }>('/api/shares/:token', async (request, reply) => {
  if (!deleteShare(db, request.params.token)) return reply.code(404).send({ error: 'No such link' });
  return { ok: true };
});

app.get<{ Querystring: { days?: string } }>('/api/history', async (request) => {
  const days = Number(request.query.days);
  return historyView(db, resolve, Number.isFinite(days) && days > 0 ? days : null);
});

app.post('/api/collect', async (_request, reply) => {
  const now = gate();
  if (!now.allowed && collecting === null) return reply.code(429).send({ error: now.reason, update: now });
  await collect();
  return { ok: true };
});

app.post<{ Body: { address?: unknown; label?: unknown } }>('/api/wallets', async (request, reply) => {
  const { address, label } = request.body ?? {};
  if (typeof address !== 'string' || address.trim() === '')
    return reply.code(400).send({ error: 'Enter a wallet address' });
  try {
    const wallet = addWallet(db, address, typeof label === 'string' ? label.slice(0, 40) : undefined);
    void (collecting ?? Promise.resolve()).then(collect);
    return { id: wallet.id, kind: wallet.kind, label: wallet.label };
  } catch (err) {
    return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.patch<{ Params: { id: string }; Body: { label?: unknown } }>('/api/accounts/:id', async (request, reply) => {
  const label = typeof request.body?.label === 'string' ? request.body.label.trim().slice(0, 40) : '';
  if (!label) return reply.code(400).send({ error: 'Enter a name for the account' });
  if (!renameAccount(db, Number(request.params.id), label)) return reply.code(404).send({ error: 'No such account' });
  return { ok: true };
});

app.post<{ Body: { exchange?: unknown; apiKey?: unknown; apiSecret?: unknown; label?: unknown } }>(
  '/api/exchanges',
  async (request, reply) => {
    const { exchange, apiKey, apiSecret, label } = request.body ?? {};
    if (typeof exchange !== 'string' || !(exchange in EXCHANGES)) {
      return reply.code(400).send({ error: 'Choose an exchange' });
    }
    const key = typeof apiKey === 'string' ? apiKey.trim() : '';
    const secret = typeof apiSecret === 'string' ? apiSecret.trim() : '';
    if (!/^[A-Za-z0-9]{16,128}$/.test(key) || !/^[A-Za-z0-9]{16,128}$/.test(secret)) {
      return reply.code(400).send({ error: 'Paste the API key and the secret key exactly as the exchange shows them' });
    }
    const keys = { apiKey: key, apiSecret: secret };
    try {
      const { extra, ipRestricted } = await checkBinanceKey(keys);
      if (extra.length > 0) {
        return reply.code(400).send({
          error: `This key can do more than read: ${extra.join(', ')}. Create a key with only Enable Reading ticked.`,
        });
      }
      const account = addExchange(
        db,
        exchange as ExchangeKind,
        keys,
        typeof label === 'string' ? label.slice(0, 40) : undefined,
      );
      void (collecting ?? Promise.resolve()).then(collect);
      return {
        id: account.id,
        label: account.label,
        warning: ipRestricted
          ? null
          : "The key is not restricted to trusted IP addresses. Restricting it to this server's address is safer.",
      };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  },
);

app.post('/api/history/reset', async () => {
  const backup = backupNow(db, 'before-history-reset');
  return { removed: resetHistory(db), backup: backup.split('/').pop() };
});

app.put<{ Params: { key: string }; Body: { category?: unknown } }>(
  '/api/assets/:key/category',
  async (request, reply) => {
    const { key } = request.params;
    const { category } = request.body ?? {};
    if (!key || key.length > 40) return reply.code(400).send({ error: 'No such asset' });
    if (category !== null && !(typeof category === 'string' && categories.includes(category))) {
      return reply.code(400).send({ error: 'Choose one of the listed categories' });
    }
    setManualCategory(db, key, category);
    loadLearned(db, learned);
    return { ok: true };
  },
);

app.delete<{ Params: { id: string } }>('/api/accounts/:id', async (request, reply) => {
  if (!removeAccount(db, Number(request.params.id))) return reply.code(404).send({ error: 'No such account' });
  return { ok: true };
});

await app.listen({ host, port });
console.log(`Stashboard is running at http://${host}:${port}`);
if (setupCode) {
  const where = config.domain && !local ? `https://${config.domain}/setup` : `http://${host}:${port}/setup`;
  console.log(`No account yet. Create one at ${where} with this setup code: ${formatCode(setupCode)}  [setup-code]`);
  if (local) console.log('Until then the dashboard is open on this machine only.');
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void app.close().then(() => {
      db.close();
      process.exit(0);
    });
  });
}
