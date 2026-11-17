export const WALLET_KINDS = ['evm', 'solana', 'ton'] as const;
export type WalletKind = (typeof WALLET_KINDS)[number];

interface ParsedAddress {
  kind: WalletKind;
  address: string;
  key: string;
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58ByteLength(s: string): number | null {
  let n = 0n;
  for (const ch of s) {
    const i = BASE58.indexOf(ch);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  let bytes = 0;
  for (; n > 0n; n >>= 8n) bytes++;
  for (const ch of s) {
    if (ch !== '1') break;
    bytes++;
  }
  return bytes;
}

function crc16(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

function tonRaw(input: string): string | null {
  const raw = /^(-?\d+):([0-9a-fA-F]{64})$/.exec(input);
  if (raw) return `${raw[1]}:${raw[2]!.toLowerCase()}`;
  if (!/^[A-Za-z0-9_\-+/]{48}$/.test(input)) return null;
  const buf = Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (buf.length !== 36) return null;
  if (crc16(buf.subarray(0, 34)) !== buf.readUInt16BE(34)) return null;
  return `${buf.readInt8(1)}:${buf.subarray(2, 34).toString('hex')}`;
}

function parseAs(kind: WalletKind, address: string): ParsedAddress | null {
  if (kind === 'evm') {
    return /^0x[0-9a-fA-F]{40}$/.test(address) ? { kind, address, key: address.toLowerCase() } : null;
  }
  if (kind === 'solana') {
    return address.length >= 32 && address.length <= 44 && base58ByteLength(address) === 32
      ? { kind, address, key: address }
      : null;
  }
  const raw = tonRaw(address);
  return raw ? { kind, address, key: raw } : null;
}

export function parseAddress(input: string): ParsedAddress {
  const address = input.trim();
  for (const k of WALLET_KINDS) {
    const parsed = parseAs(k, address);
    if (parsed) return parsed;
  }
  throw new Error(`Cannot detect the network of address: ${address}`);
}
