import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import { logoFile } from '../services/logos.ts';
import { getShare, shareHasLogo } from '../services/shares.ts';
import type { Context } from './context.ts';

export type Access = 'session' | 'signin' | 'setup' | 'public';

export interface StaticFile {
  path: string;
  file: URL;
  type: string;
  cache: boolean;
  access: Access[];
}

const AREAS: Record<string, Access[]> = {
  common: ['session', 'signin', 'setup', 'public'],
  dashboard: ['session'],
  join: ['signin'],
  login: ['signin'],
  reset: ['signin'],
  setup: ['setup'],
  share: ['public'],
};

const PAGES: Record<string, string> = {
  '/': 'dashboard',
  '/join': 'join',
  '/login': 'login',
  '/reset': 'reset',
  '/setup': 'setup',
};

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  woff2: 'font/woff2',
};

const typeOf = (name: string): string => TYPES[name.slice(name.lastIndexOf('.') + 1)] ?? 'application/octet-stream';

export function staticFiles(root: URL): StaticFile[] {
  const files: StaticFile[] = [];
  for (const [area, access] of Object.entries(AREAS)) {
    const dir = new URL(`public/${area}/`, root);
    for (const name of readdirSync(dir, { recursive: true }) as string[]) {
      if (!/\.(js|css|svg|woff2)$/.test(name)) continue;
      files.push({ path: `/${area}/${name}`, file: new URL(name, dir), type: typeOf(name), cache: false, access });
    }
  }
  for (const [path, area] of Object.entries(PAGES)) {
    files.push({
      path,
      file: new URL(`public/${area}/index.html`, root),
      type: TYPES.html!,
      cache: false,
      access: AREAS[area]!,
    });
  }
  files.push(
    {
      path: '/vendor/echarts.js',
      file: new URL('node_modules/echarts/dist/echarts.min.js', root),
      type: TYPES.js!,
      cache: true,
      access: ['session'],
    },
    {
      path: '/vendor/bricolage.woff2',
      file: new URL(
        'node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2',
        root,
      ),
      type: TYPES.woff2!,
      cache: true,
      access: AREAS.common!,
    },
    {
      path: '/logo.svg',
      file: new URL('assets/logo.svg', root),
      type: TYPES.svg!,
      cache: false,
      access: AREAS.common!,
    },
  );
  return files;
}

export function buildStamp(root: URL): string {
  const hash = createHash('sha1');
  const dir = new URL('public/', root);
  for (const name of (readdirSync(dir, { recursive: true }) as string[]).sort()) {
    if (/\.(html|js|css)$/.test(name)) hash.update(name).update(readFileSync(new URL(name, dir)));
  }
  return hash.digest('hex').slice(0, 12);
}

const ICONS = [
  'chevron-down',
  'chevron-up',
  'circle-help',
  'external-link',
  'settings',
  'landmark',
  'eye',
  'eye-off',
  'share-2',
  'download',
  'copy',
  'link',
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
  'flame',
  'snowflake',
  'wallet',
  'user-plus',
  'rotate-ccw-key',
  'list-ordered',
  'arrow-left',
];

const LOGO_POLICY = "sandbox; default-src 'none'; style-src 'unsafe-inline'";

export function registerStatic(app: FastifyInstance, ctx: Context, files: StaticFile[]): void {
  const sprite =
    '<svg xmlns="http://www.w3.org/2000/svg" hidden>' +
    ICONS.map((name) => {
      const svg = readFileSync(new URL(`node_modules/lucide-static/icons/${name}.svg`, ctx.root), 'utf8');
      const body = svg.slice(svg.indexOf('>', svg.indexOf('<svg')) + 1, svg.lastIndexOf('</svg>'));
      return `<symbol id="${name}" viewBox="0 0 24 24">${body.trim()}</symbol>`;
    }).join('') +
    '</svg>';
  const page = (file: URL): string => readFileSync(file, 'utf8').replace(/<body[^>]*>/, (tag) => tag + sprite);

  for (const { path, file, type, cache } of files) {
    app.get(path, async (_request, reply) => {
      reply.type(type).header('Cache-Control', cache ? 'public, max-age=86400' : 'no-cache');
      return type === TYPES.html ? page(file) : readFileSync(file);
    });
  }

  app.get('/healthz', async () => ({ ok: true }));

  app.get<{ Params: { kind: string; key: string } }>('/logo/:kind/:key', async (request, reply) => {
    const logo = logoFile(ctx.db, request.params.kind, request.params.key);
    if (!logo) return reply.code(404).header('Cache-Control', 'no-store').send({ error: 'No logo' });
    reply.header('Content-Security-Policy', LOGO_POLICY);
    reply.type(logo.type).header('Cache-Control', 'private, max-age=604800');
    return readFileSync(logo.path);
  });

  app.get<{ Params: { key: string } }>('/board/:key', async (_request, reply) => {
    reply.type(TYPES.html!).header('Cache-Control', 'no-cache');
    return page(new URL('public/dashboard/index.html', ctx.root)).replace('<body ', '<body data-viewing ');
  });

  app.get<{ Params: { token: string } }>('/s/:token', async (_request, reply) => {
    reply.type(TYPES.html!).header('Cache-Control', 'no-store');
    return page(new URL('public/share/index.html', ctx.root));
  });

  app.get<{ Params: { token: string; kind: string; key: string } }>(
    '/s/:token/logo/:kind/:key',
    async (request, reply) => {
      const { token, kind, key } = request.params;
      const share = getShare(ctx.db, token);
      const logo = share && shareHasLogo(share, kind, key) ? logoFile(ctx.db, kind, key) : null;
      if (!logo) return reply.code(404).header('Cache-Control', 'no-store').send({ error: 'No logo' });
      reply.header('Content-Security-Policy', LOGO_POLICY);
      reply.type(logo.type).header('Cache-Control', 'private, max-age=86400');
      return readFileSync(logo.path);
    },
  );
}
