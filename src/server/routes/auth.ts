import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  AttemptLimiter,
  hashPassword,
  matchTotp,
  newTotpSecret,
  otpauthUri,
  qrSvg,
  verifyPassword,
} from '../../auth/index.ts';
import { createSession, deleteSession, saveOwner } from '../../storage/index.ts';
import { SESSION_MS, sessionToken, setSessionCookie } from '../access.ts';
import type { Context } from '../context.ts';

const MIN_PASSWORD = 12;
const PENDING_MS = 15 * 60_000;

export function registerAuthRoutes(app: FastifyInstance, ctx: Context): void {
  const perAddress = new AttemptLimiter(5, 15 * 60_000);
  const everyone = new AttemptLimiter(50, 15 * 60_000);
  let lastTotpStep = 0;
  let pending: { passwordHash: string; totpSecret: string; at: number } | null = null;

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

  const signIn = (request: FastifyRequest, reply: FastifyReply, step: number): void => {
    lastTotpStep = step;
    perAddress.clear(request.ip);
    setSessionCookie(request, reply, createSession(ctx.db, SESSION_MS), SESSION_MS / 1000);
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

  app.post<{ Body: { setupCode?: unknown; password?: unknown } }>('/api/setup/start', async (request, reply) => {
    if (ctx.auth.owner) return reply.code(409).send({ error: 'The account already exists. Sign in instead.' });
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
      qr: qrSvg(otpauthUri(totpSecret, ctx.config.domain || 'dashboard')),
    };
  });

  app.post<{ Body: { setupCode?: unknown; code?: unknown } }>('/api/setup/finish', async (request, reply) => {
    if (ctx.auth.owner) return reply.code(409).send({ error: 'The account already exists. Sign in instead.' });
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
    ctx.auth.owner = { passwordHash: pending.passwordHash, totpSecret: pending.totpSecret };
    saveOwner(ctx.db, ctx.auth.owner);
    pending = null;
    signIn(request, reply, step);
    console.log('Account created. Setup is closed and sign-in is now required.');
    return { ok: true };
  });

  app.post<{ Body: { password?: unknown; code?: unknown } }>('/api/login', async (request, reply) => {
    const { owner } = ctx.auth;
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
    if (token) deleteSession(ctx.db, token);
    setSessionCookie(request, reply, '', 0);
    return { ok: true };
  });
}
