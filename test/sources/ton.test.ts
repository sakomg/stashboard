import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { collectTon, resetTonState, tonTiming } from '../../src/sources/ton.ts';

const WALLET = `0:${'a'.repeat(64)}`;
const OTHER = `0:${'b'.repeat(64)}`;
const original = globalThis.fetch;

type Answer = { status?: number; body: unknown };

function serve(route: (url: URL) => Answer): { url: URL; at: number; auth: string | null }[] {
  const calls: { url: URL; at: number; auth: string | null }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, at: Date.now(), auth: new Headers(init?.headers).get('authorization') });
    const { status = 200, body } = route(url);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

const tonapi =
  (balance: number, refuse: () => boolean = () => false) =>
  (url: URL): Answer => {
    if (refuse()) return { status: 429, body: { error: 'rate limit: limit for tier' } };
    if (url.pathname === '/v2/rates') return { body: { rates: { TON: { prices: { USD: 2 } } } } };
    if (url.pathname.endsWith('/jettons')) {
      return {
        body: {
          balances: [
            {
              balance: '5000000',
              price: { prices: { USD: 1 } },
              jetton: { symbol: 'USDT', decimals: 6, verification: 'whitelist' },
            },
            {
              balance: '1000000000',
              price: { prices: { USD: 9 } },
              jetton: { symbol: 'SCAM', decimals: 9, verification: 'none' },
            },
          ],
        },
      };
    }
    return { body: { balance } };
  };

beforeEach(() => {
  resetTonState();
  Object.assign(tonTiming, { minIntervalMs: 0, retryPausesMs: [0, 0, 0], priceReuseMs: 5 * 60_000 });
});
afterEach(() => {
  globalThis.fetch = original;
});

test('a wallet is read as GRAM and whitelisted jettons, with the key when there is one', async () => {
  const calls = serve(tonapi(3e9));
  const { holdings } = await collectTon('secret', WALLET);
  assert.deepEqual(
    holdings.map((h) => [h.symbol, h.quantity, h.value]),
    [
      ['GRAM', 3, 6],
      ['USDT', 5, 5],
    ],
  );
  assert.ok(calls.every((c) => c.auth === 'Bearer secret'));
  const bare = serve(tonapi(0));
  await collectTon('', WALLET);
  assert.ok(bare.every((c) => c.auth === null));
});

test('the GRAM price is asked once for many wallets, and not at all for a wallet without GRAM', async () => {
  const calls = serve(tonapi(1e9));
  await collectTon('', WALLET);
  await collectTon('', OTHER);
  assert.equal(calls.filter((c) => c.url.pathname === '/v2/rates').length, 1);

  resetTonState();
  const empty = serve(tonapi(0));
  await collectTon('', WALLET);
  assert.equal(empty.filter((c) => c.url.pathname === '/v2/rates').length, 0);
});

test('requests are spaced so a run of many wallets stays within the free tier', async () => {
  tonTiming.minIntervalMs = 40;
  const calls = serve(tonapi(1e9));
  await collectTon('', WALLET);
  await collectTon('', OTHER);
  assert.equal(calls.length, 5);
  for (let i = 1; i < calls.length; i++) {
    assert.ok(calls[i]!.at - calls[i - 1]!.at >= 38, `request ${i} came ${calls[i]!.at - calls[i - 1]!.at} ms after`);
  }
});

test('a refused request waits and tries again, and one refused every time is said in plain words', async () => {
  let refusals = 2;
  serve(tonapi(1e9, () => refusals-- > 0));
  const notes: string[] = [];
  const { holdings } = await collectTon('', WALLET, (note) => notes.push(note));
  assert.equal(holdings.length, 2);
  assert.deepEqual(notes, [
    'TonAPI asked to slow down. Trying again in 0 s',
    'TonAPI asked to slow down. Trying again in 0 s',
  ]);

  serve(tonapi(1e9, () => true));
  await assert.rejects(
    collectTon('', WALLET),
    /^Error: TonAPI kept refusing requests\. A TonAPI key in config\.json allows more$/,
  );
  await assert.rejects(
    collectTon('secret', WALLET),
    /^Error: TonAPI kept refusing requests\. It is rate limiting this key$/,
  );
});
