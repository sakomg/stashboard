import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { seal, unseal } from './vault.ts';

export const ADMIN_ID = 1;

export interface User {
  id: number;
  name: string;
  admin: boolean;
  hideAmounts: boolean;
  createdAt: string;
}

export interface Credentials {
  passwordHash: string;
  totpSecret: string;
  totpStep: number;
}

export interface NewUser extends Credentials {
  name: string;
}

interface UserRow {
  id: number;
  name: string;
  admin: number;
  hide_amounts: number;
  created_at: string;
  password_hash: string | null;
  totp_secret: string | null;
  totp_step: number;
}

const NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,31}$/u;

export const nameKey = (name: string): string => name.trim().toLowerCase();

export function checkName(name: unknown): string | null {
  return typeof name === 'string' && NAME.test(name.trim()) ? name.trim() : null;
}

const toUser = (r: UserRow): User => ({
  id: r.id,
  name: r.name,
  admin: r.admin === 1,
  hideAmounts: r.hide_amounts === 1,
  createdAt: r.created_at,
});

const toCredentials = (r: UserRow): Credentials | null =>
  r.password_hash && r.totp_secret
    ? { passwordHash: r.password_hash, totpSecret: r.totp_secret, totpStep: r.totp_step }
    : null;

export function getUser(db: DatabaseSync, id: number): User | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function findUser(db: DatabaseSync, name: string): (User & { credentials: Credentials | null }) | null {
  const row = db.prepare('SELECT * FROM users WHERE name_key = ?').get(nameKey(name)) as UserRow | undefined;
  return row ? { ...toUser(row), credentials: toCredentials(row) } : null;
}

export function adminClaimed(db: DatabaseSync): boolean {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(ADMIN_ID) as UserRow | undefined;
  return row !== undefined && toCredentials(row) !== null;
}

export function listUsers(db: DatabaseSync): (User & { accounts: number })[] {
  const rows = db
    .prepare(
      `SELECT u.*, (SELECT COUNT(*) FROM accounts a WHERE a.user_id = u.id) AS accounts
         FROM users u ORDER BY u.id`,
    )
    .all() as unknown as (UserRow & { accounts: number })[];
  return rows.map((r) => ({ ...toUser(r), accounts: r.accounts }));
}

const nameTaken = (err: unknown): boolean => err instanceof Error && /UNIQUE.*name_key/.test(err.message);

export function addUser(db: DatabaseSync, user: NewUser): User {
  try {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (name, name_key, password_hash, totp_secret, totp_step) VALUES (?, ?, ?, ?, ?)')
      .run(user.name, nameKey(user.name), user.passwordHash, user.totpSecret, user.totpStep);
    return getUser(db, Number(lastInsertRowid))!;
  } catch (err) {
    if (nameTaken(err)) throw new Error(`The name ${user.name} is taken. Choose another one.`);
    throw err;
  }
}

export function claimAdmin(db: DatabaseSync, user: NewUser): void {
  try {
    db.prepare(
      'UPDATE users SET name = ?, name_key = ?, password_hash = ?, totp_secret = ?, totp_step = ? WHERE id = ?',
    ).run(user.name, nameKey(user.name), user.passwordHash, user.totpSecret, user.totpStep, ADMIN_ID);
  } catch (err) {
    if (nameTaken(err)) throw new Error(`The name ${user.name} is taken. Choose another one.`);
    throw err;
  }
}

export function renameUser(db: DatabaseSync, id: number, name: string): void {
  try {
    db.prepare('UPDATE users SET name = ?, name_key = ? WHERE id = ?').run(name, nameKey(name), id);
  } catch (err) {
    if (nameTaken(err)) throw new Error(`The name ${name} is taken. Choose another one.`);
    throw err;
  }
}

export function clearCredentials(db: DatabaseSync, id: number): boolean {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  return (
    db
      .prepare(
        'UPDATE users SET password_hash = NULL, totp_secret = NULL, totp_step = 0 WHERE id = ? AND password_hash IS NOT NULL',
      )
      .run(id).changes > 0
  );
}

export function removeUser(db: DatabaseSync, id: number): boolean {
  return db.prepare('DELETE FROM users WHERE id = ? AND admin = 0').run(id).changes > 0;
}

export function noteTotpStep(db: DatabaseSync, id: number, step: number): void {
  db.prepare('UPDATE users SET totp_step = ? WHERE id = ?').run(step, id);
}

export function setHideAmounts(db: DatabaseSync, id: number, hide: boolean): void {
  db.prepare('UPDATE users SET hide_amounts = ? WHERE id = ?').run(hide ? 1 : 0, id);
}

const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface Invite {
  id: number;
  createdAt: string;
  expiresAt: string;
  token: string | null;
}

export function createInvite(
  db: DatabaseSync,
  createdBy: number,
  lifetimeMs: number,
  key: Buffer,
  now = Date.now(),
): Invite & { token: string } {
  const token = randomBytes(24).toString('base64url');
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + lifetimeMs).toISOString();
  const { lastInsertRowid } = db
    .prepare('INSERT INTO invites (token_hash, sealed, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(tokenHash(token), seal(key, token), createdBy, createdAt, expiresAt);
  return { id: Number(lastInsertRowid), token, createdAt, expiresAt };
}

function openInvite(key: Buffer, sealed: string | null): string | null {
  if (!sealed) return null;
  try {
    return unseal<string>(key, sealed);
  } catch {
    return null;
  }
}

export function listInvites(db: DatabaseSync, key: Buffer, now = Date.now()): Invite[] {
  db.prepare('DELETE FROM invites WHERE expires_at <= ?').run(new Date(now).toISOString());
  const rows = db
    .prepare('SELECT id, created_at AS createdAt, expires_at AS expiresAt, sealed FROM invites ORDER BY id')
    .all() as unknown as (Omit<Invite, 'token'> & { sealed: string | null })[];
  return rows.map(({ sealed, ...invite }) => ({ ...invite, token: openInvite(key, sealed) }));
}

export function inviteValid(db: DatabaseSync, token: string, now = Date.now()): boolean {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return false;
  return (
    db
      .prepare('SELECT 1 FROM invites WHERE token_hash = ? AND expires_at > ?')
      .get(tokenHash(token), new Date(now).toISOString()) !== undefined
  );
}

export function joinWithInvite(db: DatabaseSync, token: string, user: NewUser, now = Date.now()): User {
  db.exec('BEGIN');
  try {
    const used = db
      .prepare('DELETE FROM invites WHERE token_hash = ? AND expires_at > ?')
      .run(tokenHash(token), new Date(now).toISOString()).changes;
    if (used === 0) throw new Error('This invite link has expired or was already used. Ask for a new one.');
    const created = addUser(db, user);
    db.exec('COMMIT');
    return created;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function deleteInvite(db: DatabaseSync, id: number): boolean {
  return db.prepare('DELETE FROM invites WHERE id = ?').run(id).changes > 0;
}
