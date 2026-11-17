import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ADMIN_ID, sessionUser } from '../storage/index.ts';
import type { Context } from './context.ts';
import type { Access, StaticFile } from './static.ts';

const COOKIE = 'stashboard_session';
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

const CONTENT_POLICY =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const DEMO_LOCKED =
  /^(POST \/api\/(wallets|exchanges|collect|invites)|DELETE \/api\/(accounts|users|invites)\/|PATCH \/api\/me$)/;
const PUBLIC_ROUTES = [/^\/s\/[A-Za-z0-9_-]+(\/logo\/[a-z]+\/[^/]+)?$/, /^\/api\/shared\/[A-Za-z0-9_-]+$/];

declare module 'fastify' {
  interface FastifyRequest {
    userId: number;
  }
}

export function sessionToken(request: FastifyRequest): string | null {
  const match = new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]+)`).exec(request.headers.cookie ?? '');
  return match ? match[1]! : null;
}

export function setSessionCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  token: string,
  maxAgeSeconds: number,
): void {
  const secure = request.protocol === 'https' ? '; Secure' : '';
  reply.header(
    'Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`,
  );
}

export function registerAccess(app: FastifyInstance, ctx: Context, files: StaticFile[]): void {
  const openTo = (access: Access): string[] => files.filter((f) => f.access.includes(access)).map((f) => f.path);
  const signin = new Set([...openTo('signin'), '/healthz', '/api/login', '/api/join/start', '/api/join/finish']);
  const setup = new Set([...openTo('setup'), '/healthz', '/api/setup/start', '/api/setup/finish']);
  const open = new Set(openTo('public'));
  const isPublic = (path: string): boolean => open.has(path) || PUBLIC_ROUTES.some((route) => route.test(path));

  app.decorateRequest('userId', 0);

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0]!;
    if (ctx.demo && DEMO_LOCKED.test(`${request.method} ${path}`)) {
      return reply.code(403).send({ error: 'This is the demo. Install Stashboard to add your own accounts.' });
    }
    const api = path.startsWith('/api/');

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const origin = request.headers.origin;
      if (origin && new URL(origin).host !== request.headers.host) {
        return reply.code(403).send({ error: 'Cross-site request refused' });
      }
    }

    if (request.method === 'GET' && isPublic(path)) return;

    if (ctx.auth.claimed) {
      if (path === '/setup') return reply.redirect('/login');
      if (signin.has(path)) return;
      const token = sessionToken(request);
      const userId = token ? sessionUser(ctx.db, token) : null;
      if (userId !== null) {
        request.userId = userId;
        return;
      }
      return api ? reply.code(401).send({ error: 'Sign in to continue' }) : reply.redirect('/login');
    }

    if (path === '/login' || path === '/join') return reply.redirect('/setup');
    if (ctx.local) {
      request.userId = ADMIN_ID;
      return;
    }
    if (setup.has(path)) return;
    return api ? reply.code(401).send({ error: 'Create the account first' }) : reply.redirect('/setup');
  });

  app.addHook('onSend', async (request, reply) => {
    if (!reply.hasHeader('Content-Security-Policy')) reply.header('Content-Security-Policy', CONTENT_POLICY);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Robots-Tag', 'noindex');
    if (request.protocol === 'https') reply.header('Strict-Transport-Security', 'max-age=31536000');
  });
}
