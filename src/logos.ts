// Logos for tokens, chains and protocols. Sources name a URL; the server downloads each image once,
// keeps it in the data directory and serves it itself. The browser never asks a third party for a logo,
// so nobody outside learns what the portfolio holds, and the repository ships no brand assets.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Config } from './config.ts';
import { getJson } from './http.ts';
import type { LogoHint, LogoKind } from './types.ts';

const TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
};
const MAX_BYTES = 512 * 1024;
const RETRY_MS = 6 * 60 * 60 * 1000;

interface Row {
  kind: LogoKind;
  key: string;
  name: string | null;
  source_url: string | null;
  file: string | null;
  media_type: string | null;
  tried_at: string | null;
}

const dirOf = (): string => join(process.env.DATA_DIR ?? 'data', 'logos');

/** Remembers where a logo can be found. When a source names a different address, the stored image is fetched again. */
export function noteLogos(db: DatabaseSync, hints: LogoHint[]): void {
  const upsert = db.prepare(
    `INSERT INTO logos (kind, key, name, source_url) VALUES (?, ?, ?, ?)
     ON CONFLICT (kind, key) DO UPDATE SET
       name = COALESCE(excluded.name, name),
       tried_at = CASE WHEN source_url IS excluded.source_url THEN tried_at ELSE NULL END,
       file = CASE WHEN source_url IS excluded.source_url THEN file ELSE NULL END,
       source_url = excluded.source_url`,
  );
  for (const h of hints) {
    if (h.url.startsWith('https://')) upsert.run(h.kind, h.key, h.name ?? null, h.url);
  }
}

export interface Wanted {
  kind: LogoKind;
  key: string;
  /** Other spellings whose logo will do when the key itself has none (WETH for ETH). */
  alternatives?: string[];
  /** Symbols to look up on CoinGecko, most specific first. */
  lookup?: string[];
}

/** Recognises an image by its first bytes. Hosts often label logos as generic binary data, so the header is not trusted. */
export function sniffImage(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP')
    return 'image/webp';
  const head = bytes.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return null;
}

async function download(url: string): Promise<{ bytes: Buffer; type: string } | null> {
  // One retry: image hosts drop the odd connection, and a logo is not worth waiting a day for.
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8_000), redirect: 'follow' });
      if (!response.ok) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      const type = sniffImage(bytes);
      return type && bytes.length <= MAX_BYTES ? { bytes, type } : null;
    } catch (err) {
      if (attempt >= 1) throw err;
    }
  }
}

/** Looks up token logos by symbol; CoinGecko resolves a symbol to its largest coin. */
async function coingeckoLogos(apiKey: string, symbols: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (let i = 0; i < symbols.length; i += 50) {
    const batch = symbols.slice(i, i + 50).map((s) => s.toLowerCase());
    const rows = await getJson<{ symbol: string; image?: string }[]>(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&include_tokens=top&per_page=250&symbols=${encodeURIComponent(batch.join(','))}`,
      apiKey ? { 'x-cg-demo-api-key': apiKey } : {},
    );
    for (const r of rows) {
      if (r.image?.startsWith('https://') && !found.has(r.symbol.toLowerCase()))
        found.set(r.symbol.toLowerCase(), r.image);
    }
  }
  return found;
}

/** Downloads the logos that are wanted and not yet stored. Failures are remembered and retried a few hours later. */
export async function fetchMissingLogos(
  db: DatabaseSync,
  config: Config,
  wanted: Wanted[],
  now = Date.now(),
): Promise<number> {
  const get = db.prepare('SELECT * FROM logos WHERE kind = ? AND key = ?');
  const rowOf = (kind: LogoKind, key: string): Row | undefined => get.get(kind, key) as unknown as Row | undefined;
  const due = wanted.filter((w) => {
    const row = rowOf(w.kind, w.key);
    return !row?.file && (!row?.tried_at || now - Date.parse(row.tried_at) > RETRY_MS);
  });
  if (due.length === 0) return 0;

  // Where to get each one: its own hint, then CoinGecko by symbol, then the logo of a wrapper.
  const needLookup = due.filter((w) => w.kind === 'token' && !rowOf(w.kind, w.key)?.source_url);
  let looked = new Map<string, string>();
  try {
    looked = await coingeckoLogos(config.coingecko.apiKey, [
      ...new Set(needLookup.flatMap((w) => w.lookup ?? [w.key])),
    ]);
  } catch (err) {
    console.warn(`logos: CoinGecko lookup failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  mkdirSync(dirOf(), { recursive: true });
  const save = db.prepare(
    `INSERT INTO logos (kind, key, source_url, file, media_type, tried_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (kind, key) DO UPDATE SET source_url = excluded.source_url, file = excluded.file,
       media_type = excluded.media_type, tried_at = excluded.tried_at`,
  );
  let stored = 0;
  const fetchOne = async (w: Wanted): Promise<void> => {
    const candidates = [
      rowOf(w.kind, w.key)?.source_url,
      ...(w.lookup ?? [w.key]).map((s) => looked.get(s.toLowerCase())),
      ...(w.alternatives ?? []).map((alt) => rowOf(w.kind, alt)?.source_url),
    ].filter((u): u is string => Boolean(u));

    let saved: { url: string; file: string; type: string } | null = null;
    for (const url of candidates) {
      try {
        const image = await download(url);
        if (!image) continue;
        const file = `${w.kind}-${createHash('sha1').update(w.key).digest('hex').slice(0, 16)}.${TYPES[image.type]}`;
        writeFileSync(join(dirOf(), file), image.bytes);
        saved = { url, file, type: image.type };
        break;
      } catch {
        // Try the next candidate.
      }
    }
    save.run(
      w.kind,
      w.key,
      // What the source named stays on record even when a fallback supplied the image, so the same hint
      // arriving again is not mistaken for a new address.
      rowOf(w.kind, w.key)?.source_url ?? saved?.url ?? candidates[0] ?? null,
      saved?.file ?? null,
      saved?.type ?? null,
      new Date(now).toISOString(),
    );
    if (saved) stored++;
  };
  // A few at a time: fast enough for a first run, gentle on the image hosts.
  const queue = [...due];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let w = queue.shift(); w; w = queue.shift()) await fetchOne(w);
    }),
  );
  return stored;
}

/** The stored file of a logo, if it has been downloaded. */
export function logoFile(db: DatabaseSync, kind: string, key: string): { path: string; type: string } | null {
  const row = db
    .prepare('SELECT file, media_type FROM logos WHERE kind = ? AND key = ? AND file IS NOT NULL')
    .get(kind, key) as { file: string; media_type: string } | undefined;
  return row ? { path: join(dirOf(), row.file), type: row.media_type } : null;
}

/**
 * What the page may ask for: every stored logo as "kind/key" with a version that changes when the image does
 * (browsers keep logos for a week, so a replaced one needs a new address), and chain display names.
 */
export function logoIndex(db: DatabaseSync): { available: Record<string, string>; chains: Record<string, string> } {
  const rows = db.prepare('SELECT kind, key, name, source_url, file FROM logos').all() as unknown as Row[];
  const version = (r: Row): string => createHash('sha1').update(`${r.source_url}\n${r.file}`).digest('hex').slice(0, 8);
  return {
    available: Object.fromEntries(rows.filter((r) => r.file).map((r) => [`${r.kind}/${r.key}`, version(r)])),
    chains: Object.fromEntries(rows.filter((r) => r.kind === 'chain' && r.name).map((r) => [r.key, r.name!])),
  };
}
