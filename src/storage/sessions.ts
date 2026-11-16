import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

export function createSession(db: DatabaseSync, userId: number, lifetimeMs: number, now = Date.now()): string {
  const token = randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date(now).toISOString());
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    tokenHash(token),
    userId,
    new Date(now).toISOString(),
    new Date(now + lifetimeMs).toISOString(),
  );
  return token;
}

export function sessionUser(db: DatabaseSync, token: string, now = Date.now()): number | null {
  const row = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(tokenHash(token)) as
    { user_id: number; expires_at: string } | undefined;
  return row !== undefined && Date.parse(row.expires_at) > now ? row.user_id : null;
}

export function deleteSession(db: DatabaseSync, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}
