// Login building blocks: password hashing (argon2id), TOTP (RFC 6238) and attempt limiting.
import { argon2Sync, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// ── Password ─────────────────────────────────────────────────────────────────

const ARGON = { parallelism: 1, tagLength: 32, memory: 65536, passes: 3 };

/** Returns `argon2id$<salt>$<hash>`, both base64url. */
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

// ── TOTP ─────────────────────────────────────────────────────────────────────

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

export function base32Encode(bytes: Uint8Array): string {
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5) out += BASE32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = '';
  for (const ch of text.toUpperCase().replace(/[\s=-]/g, '')) {
    const value = BASE32.indexOf(ch);
    if (value < 0) throw new Error('TOTP secret is not valid base32');
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((b) => parseInt(b, 2)));
}

export const newTotpSecret = (): string => base32Encode(randomBytes(20));

/** The six-digit code for a 30-second step (SHA-1, as every authenticator app expects). */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

/**
 * Returns the step a code belongs to, allowing one step of clock drift either way; null if it matches none.
 * The caller remembers the step so the same code cannot be used twice.
 */
export function matchTotp(secret: string, code: string, now = Date.now()): number | null {
  const given = Buffer.from(code.replace(/\s/g, '').padEnd(6).slice(0, 6));
  const current = Math.floor(now / 1000 / STEP_SECONDS);
  let matched: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    if (timingSafeEqual(Buffer.from(totpCode(secret, step)), given)) matched = step;
  }
  return matched;
}

export function otpauthUri(secret: string, account: string): string {
  return `otpauth://totp/Stashboard:${encodeURIComponent(account)}?secret=${secret}&issuer=Stashboard`;
}

// ── Attempt limiting ─────────────────────────────────────────────────────────

/** Counts failures per key inside a sliding window and locks the key out once it reaches the limit. */
export class AttemptLimiter {
  private readonly failures = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  private recent(key: string, now: number): number[] {
    const kept = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (kept.length > 0) this.failures.set(key, kept);
    else this.failures.delete(key);
    return kept;
  }

  /** Seconds until the key may try again; 0 when it is not locked out. */
  retryAfter(key: string, now = Date.now()): number {
    const recent = this.recent(key, now);
    return recent.length < this.limit ? 0 : Math.ceil((recent[0]! + this.windowMs - now) / 1000);
  }

  fail(key: string, now = Date.now()): void {
    this.failures.set(key, [...this.recent(key, now), now]);
  }

  clear(key: string): void {
    this.failures.delete(key);
  }
}
