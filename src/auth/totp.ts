import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

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

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

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
