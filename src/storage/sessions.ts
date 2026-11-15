import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

export function createSession(db: DatabaseSync, lifetimeMs: number, now = Date.now()): string {
  const token = randomBytes(32).toString('base64url');
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date(now).toISOString());
  db.prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)').run(
    tokenHash(token),
    new Date(now).toISOString(),
    new Date(now + lifetimeMs).toISOString(),
  );
  return token;
}

export function sessionValid(db: DatabaseSync, token: string, now = Date.now()): boolean {
  const row = db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(tokenHash(token)) as
    { expires_at: string } | undefined;
  return row !== undefined && Date.parse(row.expires_at) > now;
}

export function deleteSession(db: DatabaseSync, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}

export interface Owner {
  passwordHash: string;
  totpSecret: string;
}

export function getOwner(db: DatabaseSync): Owner | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'owner'").get() as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as Owner) : null;
}

export function saveOwner(db: DatabaseSync, owner: Owner): void {
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('owner', ?)").run(JSON.stringify(owner));
}

export function deleteOwner(db: DatabaseSync): boolean {
  db.prepare('DELETE FROM sessions').run();
  return db.prepare("DELETE FROM settings WHERE key = 'owner'").run().changes > 0;
}
