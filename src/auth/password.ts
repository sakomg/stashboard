import { argon2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

const ARGON = { parallelism: 1, tagLength: 32, memory: 65536, passes: 3 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = argon2Sync('argon2id', { message: Buffer.from(password, 'utf8'), nonce: salt, ...ARGON });
  return `argon2id$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'argon2id' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = argon2Sync('argon2id', {
    message: Buffer.from(password, 'utf8'),
    nonce: Buffer.from(salt, 'base64url'),
    ...ARGON,
    tagLength: expected.length,
  });
  return timingSafeEqual(actual, expected);
}
