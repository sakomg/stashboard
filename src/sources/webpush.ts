import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign } from 'node:crypto';
import { HttpError } from '../lib/http.ts';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

const PUSH_HOSTS = ['fcm.googleapis.com', 'push.apple.com', 'push.services.mozilla.com', 'notify.windows.com'];
const RECORD_SIZE = 4096;
const TTL_SECONDS = 24 * 60 * 60;

export function pushTargetProblem(target: { endpoint?: unknown; p256dh?: unknown; auth?: unknown }): string | null {
  const { endpoint, p256dh, auth } = target;
  if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string') {
    return 'This browser sent an incomplete subscription';
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return 'This browser sent an incomplete subscription';
  }
  const known = PUSH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  if (url.protocol !== 'https:' || !known) return 'Notifications from this browser are not supported';
  const key = Buffer.from(p256dh, 'base64url');
  if (key.length !== 65 || key[0] !== 4 || Buffer.from(auth, 'base64url').length !== 16) {
    return 'This browser sent an incomplete subscription';
  }
  return null;
}

export function newVapidKeys(): VapidKeys {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: ecdh.getPublicKey('base64url'), privateKey: ecdh.getPrivateKey('base64url') };
}

export function vapidAuthorization(endpoint: string, vapid: VapidKeys, subject: string, now = Date.now()): string {
  const point = Buffer.from(vapid.publicKey, 'base64url');
  const key = createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: vapid.privateKey,
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33).toString('base64url'),
    },
  });
  const part = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 60 * 60,
    sub: subject,
  })}`;
  const signature = sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${signature.toString('base64url')}, k=${vapid.publicKey}`;
}

export function encryptPayload(
  payload: Buffer,
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  fixed?: { senderKey: Buffer; salt: Buffer },
): Buffer {
  const receiver = Buffer.from(target.p256dh, 'base64url');
  const sender = createECDH('prime256v1');
  if (fixed) sender.setPrivateKey(fixed.senderKey);
  else sender.generateKeys();
  const senderPublic = sender.getPublicKey();
  const salt = fixed?.salt ?? randomBytes(16);
  const info = (text: string): Buffer => Buffer.from(`${text}\0`);
  const ikm = Buffer.from(
    hkdfSync(
      'sha256',
      sender.computeSecret(receiver),
      Buffer.from(target.auth, 'base64url'),
      Buffer.concat([info('WebPush: info'), receiver, senderPublic]),
      32,
    ),
  );
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, info('Content-Encoding: aes128gcm'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, info('Content-Encoding: nonce'), 12));
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const sealed = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final()]);
  const header = Buffer.alloc(21);
  salt.copy(header);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(senderPublic.length, 20);
  return Buffer.concat([header, senderPublic, sealed, cipher.getAuthTag()]);
}

export async function sendPush(
  target: PushTarget,
  message: object,
  vapid: VapidKeys,
  subject: string,
): Promise<'sent' | 'gone'> {
  const res = await fetch(target.endpoint, {
    method: 'POST',
    headers: {
      authorization: vapidAuthorization(target.endpoint, vapid, subject),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: String(TTL_SECONDS),
      urgency: 'normal',
    },
    body: new Uint8Array(encryptPayload(Buffer.from(JSON.stringify(message)), target)),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404 || res.status === 410) return 'gone';
  if (!res.ok) throw new HttpError(new URL(target.endpoint).host, res.status, await res.text().catch(() => ''));
  return 'sent';
}
