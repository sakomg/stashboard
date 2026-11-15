import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const keys = new Map<string, Buffer>();

export function vaultKey(dir = process.env.DATA_DIR ?? 'data'): Buffer {
  const cached = keys.get(dir);
  if (cached) return cached;
  const file = join(dir, 'secret.key');
  if (!existsSync(file)) {
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(file, randomBytes(32), { mode: 0o600, flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  const key = readFileSync(file);
  if (key.length !== 32) throw new Error(`${file} must hold exactly 32 bytes`);
  keys.set(dir, key);
  return key;
}

export function seal(key: Buffer, value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64url')).join('.');
}

export function unseal<T>(key: Buffer, sealed: string): T {
  const [iv, tag, data] = sealed.split('.').map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !data) throw new Error('A stored secret is damaged');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')) as T;
}
