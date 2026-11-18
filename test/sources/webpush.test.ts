import assert from 'node:assert/strict';
import { createPublicKey, verify } from 'node:crypto';
import { afterEach, test } from 'node:test';
import {
  encryptPayload,
  newVapidKeys,
  pushTargetProblem,
  sendPush,
  vapidAuthorization,
} from '../../src/sources/webpush.ts';

const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

const receiver = {
  p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
};

test('a payload is encrypted exactly as the example in RFC 8291', () => {
  const message = encryptPayload(Buffer.from('When I grow up, I want to be a watermelon'), receiver, {
    senderKey: Buffer.from('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', 'base64url'),
    salt: Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url'),
  });
  assert.equal(
    message.toString('base64url'),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
  );
});

test('the VAPID header is a JWT for the push service, signed by the key it names', () => {
  const vapid = newVapidKeys();
  const now = Date.parse('2026-11-18T12:00:00Z');
  const header = vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', vapid, 'https://stash.example', now);
  const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(header);
  assert.ok(match, header);
  const [, head, claims, signature, k] = match;
  assert.equal(k, vapid.publicKey);
  assert.deepEqual(JSON.parse(Buffer.from(head!, 'base64url').toString()), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(Buffer.from(claims!, 'base64url').toString()), {
    aud: 'https://fcm.googleapis.com',
    exp: now / 1000 + 12 * 60 * 60,
    sub: 'https://stash.example',
  });
  const point = Buffer.from(k!, 'base64url');
  const key = createPublicKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: point.subarray(1, 33).toString('base64url'),
      y: point.subarray(33).toString('base64url'),
    },
  });
  assert.ok(
    verify(
      'sha256',
      Buffer.from(`${head}.${claims}`),
      { key, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature!, 'base64url'),
    ),
  );
});

test('only the push services of browsers are accepted as a subscription', () => {
  const ok = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', ...receiver };
  assert.equal(pushTargetProblem(ok), null);
  assert.equal(pushTargetProblem({ ...ok, endpoint: 'https://web.push.apple.com/QGx' }), null);
  for (const endpoint of [
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com.example.com/x',
    'https://localhost:8787/api/collect',
    'https://169.254.169.254/latest',
  ]) {
    assert.equal(pushTargetProblem({ ...ok, endpoint }), 'Notifications from this browser are not supported', endpoint);
  }
  assert.match(pushTargetProblem({ ...ok, p256dh: 'AAAA' }) ?? '', /incomplete/);
  assert.match(pushTargetProblem({ ...ok, auth: undefined }) ?? '', /incomplete/);
  assert.match(pushTargetProblem({ ...ok, endpoint: 'not a url' }) ?? '', /incomplete/);
});

test('a push is sent encrypted with a time to live, and a subscription that is gone says so', async () => {
  const sent: { url: string; init: RequestInit }[] = [];
  let status = 201;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, init });
    return new Response('', { status });
  }) as typeof fetch;
  const target = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', ...receiver };
  const vapid = newVapidKeys();

  assert.equal(await sendPush(target, { title: 'Hi' }, vapid, 'https://stash.example'), 'sent');
  const headers = sent[0]!.init.headers as Record<string, string>;
  assert.equal(headers['content-encoding'], 'aes128gcm');
  assert.equal(headers.ttl, '86400');
  assert.match(headers.authorization!, /^vapid t=/);
  assert.equal((sent[0]!.init.body as Uint8Array).length, 21 + 65 + JSON.stringify({ title: 'Hi' }).length + 1 + 16);

  status = 410;
  assert.equal(await sendPush(target, { title: 'Hi' }, vapid, 'https://stash.example'), 'gone');
  status = 500;
  await assert.rejects(
    sendPush(target, { title: 'Hi' }, vapid, 'https://stash.example'),
    /fcm\.googleapis\.com → HTTP 500/,
  );
});
