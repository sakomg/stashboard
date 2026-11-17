import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { errorText } from '../../lib/errors.ts';
import {
  AttemptLimiter,
  hashPassword,
  matchTotp,
  newTotpSecret,
  otpauthUri,
  qrSvg,
  verifyPassword,
} from '../../auth/index.ts';
import {
  ADMIN_ID,
  checkName,
  claimAdmin,
  createSession,
  deleteSession,
  findUser,
  inviteValid,
  joinWithInvite,
  noteTotpStep,
} from '../../storage/index.ts';
import { SESSION_MS, sessionToken, setSessionCookie } from '../access.ts';
import type { Context } from '../context.ts';

const MIN_PASSWORD = 12;
const PENDING_MS = 15 * 60_000;
const NAME_RULE = 'Use a name of up to 32 letters, digits, spaces, dots, dashes or underscores.';
const INVITE_USED = 'This invite link has expired or was already used. Ask for a new one.';

interface Pending {
  name: string;
  passwordHash: string;
  totpSecret: string;
  at: number;
}

export function registerAuthRoutes(app: FastifyInstance, ctx: Context): void {
  const perAddress = new AttemptLimiter(5, 15 * 60_000);
  const everyone = new AttemptLimiter(50, 15 * 60_000);
  let decoy: string | null = null;
  const decoyHash = (): string => (decoy ??= hashPassword(randomBytes(16).toString('base64url')));
  let pendingSetup: Pending | null = null;
  const pendingJoins = new Map<string, Pending>();

  const lockedOut = (request: FastifyRequest, reply: FastifyReply): boolean => {
    const wait = Math.max(perAddress.retryAfter(request.ip), everyone.retryAfter('all'));
    if (wait === 0) return false;
    void reply
      .code(429)
      .header('Retry-After', wait)
      .send({ error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} min.` });
    return true;
  };

  const failed = (request: FastifyRequest, what: string): void => {
    perAddress.fail(request.ip);
    everyone.fail('all');
    app.log.warn({ ip: request.ip }, what);
  };

  const signIn = (request: FastifyRequest, reply: FastifyReply, userId: number): void => {
    perAddress.clear(request.ip);
    setSessionCookie(request, reply, createSession(ctx.db, userId, SESSION_MS), SESSION_MS / 1000);
  };

  const setupCodeMatches = (given: unknown): boolean => {
    const { setupCode } = ctx.auth;
    if (!setupCode || typeof given !== 'string') return false;
    const normalised = Buffer.from(
      given
        .toUpperCase()
        .replace(/[^A-Z2-7]/g, '')
        .padEnd(setupCode.length)
        .slice(0, setupCode.length),
    );
    return timingSafeEqual(normalised, Buffer.from(setupCode));
  };

  const enrol = (name: unknown, password: unknown, self: number | null): Pending | string => {
    const checked = checkName(name);
    if (!checked) return NAME_RULE;
    const taken = findUser(ctx.db, checked);
    if (taken && taken.id !== self) return `The name ${checked} is taken. Choose another one.`;
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
      return `Use a password of at least ${MIN_PASSWORD} characters.`;
    }
    return { name: checked, passwordHash: hashPassword(password), totpSecret: newTotpSecret(), at: Date.now() };
  };

  const authenticator = ({ name, totpSecret }: Pending) => ({
    key: totpSecret.match(/.{1,4}/g)!.join(' '),
    qr: qrSvg(otpauthUri(totpSecret, `${name}@${ctx.config.domain || 'dashboard'}`)),
  });

  const codeStep = (pending: Pending, code: unknown): number | null =>
    typeof code === 'string' ? matchTotp(pending.totpSecret, code) : null;

  app.post<{ Body: { setupCode?: unknown; name?: unknown; password?: unknown } }>(
    '/api/setup/start',
    async (request, reply) => {
      if (ctx.auth.claimed) return reply.code(409).send({ error: 'The account already exists. Sign in instead.' });
      if (lockedOut(request, reply)) return reply;
      if (!setupCodeMatches(request.body?.setupCode)) {
        failed(request, 'wrong setup code');
        return reply.code(401).send({
          error: 'That setup code is not right. It is printed in the server log each time the server starts.',
        });
      }
      const pending = enrol(request.body?.name, request.body?.password, ADMIN_ID);
      if (typeof pending === 'string') return reply.code(400).send({ error: pending });
      pendingSetup = pending;
      return authenticator(pending);
    },
  );

  app.post<{ Body: { setupCode?: unknown; code?: unknown } }>('/api/setup/finish', async (request, reply) => {
    if (ctx.auth.claimed) return reply.code(409).send({ error: 'The account already exists. Sign in instead.' });
    if (lockedOut(request, reply)) return reply;
    if (!setupCodeMatches(request.body?.setupCode)) {
      failed(request, 'wrong setup code');
      return reply.code(401).send({ error: 'That setup code is not right.' });
    }
    if (!pendingSetup || Date.now() - pendingSetup.at > PENDING_MS) {
      pendingSetup = null;
      return reply.code(400).send({ error: 'Setup took too long and was reset. Start again.' });
    }
    const step = codeStep(pendingSetup, request.body?.code);
    if (step === null) {
      failed(request, 'wrong authenticator code during setup');
      return reply
        .code(401)
        .send({ error: 'That code does not match. Check the app shows this account and try the next code.' });
    }
    const { name, passwordHash, totpSecret } = pendingSetup;
    try {
      claimAdmin(ctx.db, { name, passwordHash, totpSecret, totpStep: step });
    } catch (err) {
      pendingSetup = null;
      return reply.code(400).send({ error: errorText(err) });
    }
    ctx.auth.claimed = true;
    pendingSetup = null;
    signIn(request, reply, ADMIN_ID);
    console.log('Account created. Setup is closed and sign-in is now required.');
    return { ok: true };
  });

  app.post<{ Body: { token?: unknown; name?: unknown; password?: unknown } }>(
    '/api/join/start',
    async (request, reply) => {
      if (!ctx.auth.claimed) return reply.code(409).send({ error: 'This server has no account to join yet.' });
      if (lockedOut(request, reply)) return reply;
      const token = typeof request.body?.token === 'string' ? request.body.token : '';
      if (!inviteValid(ctx.db, token)) {
        failed(request, 'unknown or used invite');
        return reply.code(401).send({ error: INVITE_USED });
      }
      const pending = enrol(request.body?.name, request.body?.password, null);
      if (typeof pending === 'string') return reply.code(400).send({ error: pending });
      for (const [key, old] of pendingJoins) if (Date.now() - old.at > PENDING_MS) pendingJoins.delete(key);
      pendingJoins.set(token, pending);
      return authenticator(pending);
    },
  );

  app.post<{ Body: { token?: unknown; code?: unknown } }>('/api/join/finish', async (request, reply) => {
    if (!ctx.auth.claimed) return reply.code(409).send({ error: 'This server has no account to join yet.' });
    if (lockedOut(request, reply)) return reply;
    const token = typeof request.body?.token === 'string' ? request.body.token : '';
    const pending = pendingJoins.get(token);
    if (!pending || Date.now() - pending.at > PENDING_MS) {
      pendingJoins.delete(token);
      return reply.code(400).send({ error: 'Joining took too long and was reset. Start again.' });
    }
    const step = codeStep(pending, request.body?.code);
    if (step === null) {
      failed(request, 'wrong authenticator code while joining');
      return reply
        .code(401)
        .send({ error: 'That code does not match. Check the app shows this account and try the next code.' });
    }
    pendingJoins.delete(token);
    const { name, passwordHash, totpSecret } = pending;
    let userId: number;
    try {
      userId = joinWithInvite(ctx.db, token, { name, passwordHash, totpSecret, totpStep: step }).id;
    } catch (err) {
      return reply.code(400).send({ error: errorText(err) });
    }
    signIn(request, reply, userId);
    return { ok: true };
  });

  app.post<{ Body: { name?: unknown; password?: unknown; code?: unknown } }>('/api/login', async (request, reply) => {
    if (!ctx.auth.claimed) return reply.code(409).send({ error: 'There is no account yet. Create it first.' });
    if (lockedOut(request, reply)) return reply;
    const { name, password, code } = request.body ?? {};
    const user = typeof name === 'string' ? findUser(ctx.db, name) : null;
    const credentials = user?.credentials ?? null;
    const passwordOk =
      typeof password === 'string' && verifyPassword(password, credentials?.passwordHash ?? decoyHash());
    const step = credentials && typeof code === 'string' ? matchTotp(credentials.totpSecret, code) : null;
    if (!user || !credentials || !passwordOk || step === null || step <= credentials.totpStep) {
      failed(request, 'failed sign-in');
      return reply.code(401).send({ error: 'Wrong name, password or code' });
    }
    noteTotpStep(ctx.db, user.id, step);
    signIn(request, reply, user.id);
    return { ok: true };
  });

  app.post('/api/logout', async (request, reply) => {
    const token = sessionToken(request);
    if (token) deleteSession(ctx.db, token);
    setSessionCookie(request, reply, '', 0);
    return { ok: true };
  });
}
