import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { LogoKind } from '../domain/types.ts';

export interface ShareRow {
  name: string;
  share: number;
  value: number | null;
  color: string;
  logo: { kind: LogoKind; key: string } | null;
}

export interface SharePayload {
  title: string;
  rows: ShareRow[];
  total: number | null;
  netWorth: number | null;
  borrowed: number | null;
  createdAt: string;
}

export interface Share {
  token: string;
  createdAt: string;
  expiresAt: string;
  payload: SharePayload;
}

export const SHARE_DAYS = [1, 7, 30];
const MAX_ROWS = 12;
const LOGO_KINDS: LogoKind[] = ['token', 'chain', 'protocol'];

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : null;
const amount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e12 ? value : null;

export function parseSharePayload(
  body: unknown,
  now = new Date(),
): { payload: SharePayload; days: number } | { error: string } {
  const input = (body ?? {}) as Record<string, unknown>;
  const title = text(input.title, 80);
  if (!title) return { error: 'The share needs a title' };
  const days = Number(input.days);
  if (!SHARE_DAYS.includes(days)) return { error: `A link lasts ${SHARE_DAYS.join(', ')} days` };
  if (!Array.isArray(input.rows) || input.rows.length === 0 || input.rows.length > MAX_ROWS) {
    return { error: 'Nothing to share' };
  }
  const withAmounts = input.showAmounts === true;
  const rows: ShareRow[] = [];
  for (const raw of input.rows as Record<string, unknown>[]) {
    const name = text(raw?.name, 60);
    const share = amount(raw?.share);
    const color = typeof raw?.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : null;
    if (!name || share === null || !color) return { error: 'A share row is malformed' };
    const logoInput = raw.logo as Record<string, unknown> | null | undefined;
    const kind = LOGO_KINDS.find((k) => k === logoInput?.kind);
    const key = text(logoInput?.key, 60);
    rows.push({
      name,
      share,
      value: withAmounts ? amount(raw.value) : null,
      color,
      logo: kind && key ? { kind, key } : null,
    });
  }
  const borrowed = amount(input.borrowed);
  return {
    payload: {
      title,
      rows,
      total: withAmounts ? amount(input.total) : null,
      netWorth: withAmounts ? amount(input.netWorth) : null,
      borrowed: withAmounts && borrowed !== null && borrowed >= 0 ? borrowed : null,
      createdAt: now.toISOString(),
    },
    days,
  };
}

export function createShare(db: DatabaseSync, payload: SharePayload, days: number, now = Date.now()): Share {
  const token = randomBytes(16).toString('base64url');
  const share = {
    token,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + days * 24 * 60 * 60_000).toISOString(),
    payload,
  };
  db.prepare('INSERT INTO shares (token, created_at, expires_at, payload) VALUES (?, ?, ?, ?)').run(
    share.token,
    share.createdAt,
    share.expiresAt,
    JSON.stringify(payload),
  );
  return share;
}

const toShare = (row: { token: string; created_at: string; expires_at: string; payload: string }): Share => ({
  token: row.token,
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  payload: JSON.parse(row.payload) as SharePayload,
});

export function getShare(db: DatabaseSync, token: string, now = Date.now()): Share | null {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const row = db
    .prepare('SELECT * FROM shares WHERE token = ? AND expires_at > ?')
    .get(token, new Date(now).toISOString()) as
    { token: string; created_at: string; expires_at: string; payload: string } | undefined;
  return row ? toShare(row) : null;
}

export function listShares(db: DatabaseSync, now = Date.now()): Share[] {
  db.prepare('DELETE FROM shares WHERE expires_at <= ?').run(new Date(now).toISOString());
  const rows = db.prepare('SELECT * FROM shares ORDER BY created_at DESC').all() as unknown as {
    token: string;
    created_at: string;
    expires_at: string;
    payload: string;
  }[];
  return rows.map(toShare);
}

export function deleteShare(db: DatabaseSync, token: string): boolean {
  return db.prepare('DELETE FROM shares WHERE token = ?').run(token).changes > 0;
}

export const shareHasLogo = (share: Share, kind: string, key: string): boolean =>
  share.payload.rows.some((r) => r.logo?.kind === kind && r.logo.key === key);
