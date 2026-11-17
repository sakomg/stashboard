import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { afterEach, test } from 'node:test';
import { checkBingxKey, collectBingx, pingBingx } from '../../src/sources/bingx.ts';

const keys = {
  apiKey: 'Zq7mW2xKp9Lr4Tn8Vb3Hc6Jd1Fg5Sa0Ey2Uo7Ii4Pk9Ml3Nb8Xc1Zv6Bn5Mq2Wd',
  apiSecret: 'r8Tq2Lm6Wn4Xp0Kz9Hb7Vc3Jd5Fg1Sa8Ey6Uo2Ii4Pk7Ml9Nb3Xc5Zv1Bn0Mq',
};
const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

type Answer = { status?: number; body: unknown };
const ok = (data: unknown): Answer => ({ body: { code: 0, msg: '', data } });
const refused = (code: number, status = 200): Answer => ({ status, body: { code, msg: 'refused' } });

function serve(route: (url: URL) => Answer): { url: URL; headers: Headers }[] {
  const calls: { url: URL; headers: Headers }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    const { status = 200, body } = route(url);
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

test('a read-only key passes, and the request is signed with HMAC-SHA256 over the query', async () => {
  const calls = serve(() => ok({ apiKey: keys.apiKey, permissions: [2], ipAddresses: ['203.0.113.7'], note: '' }));
  assert.deepEqual(await checkBingxKey(keys), { extra: [], ipRestricted: true });

  const [call] = calls;
  assert.equal(call!.url.origin + call!.url.pathname, 'https://open-api.bingx.com/openApi/v1/account/apiPermissions');
  assert.equal(call!.headers.get('x-bx-apikey'), keys.apiKey);
  const timestamp = call!.url.searchParams.get('timestamp')!;
  assert.match(timestamp, /^\d{13}$/);
  const expected = createHmac('sha256', keys.apiSecret).update(`timestamp=${timestamp}`).digest('hex');
  assert.equal(call!.url.searchParams.get('signature'), expected);
  assert.equal(call!.url.search, `?timestamp=${timestamp}&signature=${expected}`);
});

test('a key that can trade or move funds is refused with what it can do, and an unbound key is not IP-restricted', async () => {
  serve(() => ok({ apiKey: keys.apiKey, permissions: [1, 2, 3, 5, 9], ipAddresses: [], note: '' }));
  assert.deepEqual(await checkBingxKey(keys), {
    extra: ['spot trading', 'futures trading', 'withdrawals', 'permission 9'],
    ipRestricted: false,
  });
});

test('a key whose permissions are not listed is refused, and refusals are in plain words', async () => {
  serve(() => ok({ apiKey: keys.apiKey, ipAddresses: [] }));
  await assert.rejects(checkBingxKey(keys), /did not list this key's permissions/);
  serve(() => refused(100413));
  await assert.rejects(checkBingxKey(keys), /BingX refused the key: it does not know this API key\./);
  serve(() => refused(100001));
  await assert.rejects(checkBingxKey(keys), /the secret does not match it/);
  serve(() => refused(100419));
  await assert.rejects(checkBingxKey(keys), /does not allow this server's IP address/);
  serve(() => refused(100421, 400));
  await assert.rejects(checkBingxKey(keys), /clock is off/);
});

test('the ping reads the server time without a key', async () => {
  const calls = serve(() => ok({ serverTime: 1794925694 }));
  assert.equal(await pingBingx(), 'market API is reachable from this IP');
  assert.equal(calls[0]!.url.pathname, '/openApi/spot/v1/server/time');
  assert.equal(calls[0]!.headers.get('x-bx-apikey'), null);
});

const tickers = [
  { symbol: 'BTC-USDT', lastPrice: 60000 },
  { symbol: 'ETH-USDT', lastPrice: '3000' },
  { symbol: 'SOL-USDC', lastPrice: 150 },
  { symbol: 'USDC-USDT', lastPrice: 1 },
];

test('Spot, Funding and every kind of futures are read, priced from BingX tickers, with the overview as cross-check', async () => {
  serve((url) => {
    switch (url.pathname) {
      case '/openApi/spot/v1/account/balance':
        return ok({
          balances: [
            { asset: 'BTC', free: '0.5', locked: '0.25' },
            { asset: 'DUST', free: '0', locked: '0' },
          ],
        });
      case '/openApi/fund/v1/account/balance':
        return ok({ assets: [{ asset: 'SOL', free: '2', locked: '1' }] });
      case '/openApi/swap/v3/user/balance':
        return ok([
          { asset: 'USDT', balance: '1000', equity: '960', unrealizedProfit: '-40' },
          { asset: 'USDC', balance: '0', equity: '0', unrealizedProfit: '0' },
        ]);
      case '/openApi/cswap/v1/user/balance':
        return ok([{ asset: 'ETH', balance: '0.5', equity: '0.6', unrealizedProfit: '0.1' }]);
      case '/openApi/contract/v1/balance':
        return ok([{ asset: 'USDT', balance: '100', crossWalletBalance: '100', crossUnPnl: '-5' }]);
      case '/openApi/spot/v2/quote/ticker':
        return ok(tickers);
      case '/openApi/account/v1/allAccountBalance':
        return ok({
          result: [
            { accountType: 'sopt', usdtBalance: '45450' },
            { accountType: 'USDTMPerp', usdtBalance: '960' },
            { accountType: 'coinMPerp', usdtBalance: '1800' },
            { accountType: 'stdFutures', usdtBalance: '95' },
            { accountType: 'copyTrading', usdtBalance: '120.25' },
            { accountType: 'grid', usdtBalance: '0.25' },
          ],
          pageId: 1,
          total: 6,
        });
      default:
        return refused(100400);
    }
  });

  const result = await collectBingx(keys);
  assert.deepEqual(
    result.holdings.map((h) => [h.protocol, h.symbol, h.type, h.value]),
    [
      ['Spot', 'BTC', 'wallet', 45000],
      ['Funding', 'SOL', 'wallet', 450],
      ['Perpetual Futures', 'USDT', 'futures', 960],
      ['Coin-M Futures', 'ETH', 'futures', 1800],
      ['Standard Futures', 'USDT', 'futures', 95],
    ],
  );
  assert.ok(result.holdings.every((h) => h.chain === 'bingx'));
  assert.equal(result.reportedTotal, 48425.5);
  assert.deepEqual(result.warnings, ['Copy trading, worth 120 USDT, is not read']);
});

test('a wallet that cannot be read becomes a warning, and the Spot account failing fails the account', async () => {
  serve((url) => {
    switch (url.pathname) {
      case '/openApi/spot/v1/account/balance':
        return ok({ balances: [{ asset: 'BTC', free: '1', locked: '0' }] });
      case '/openApi/fund/v1/account/balance':
        return ok({ balances: [] });
      case '/openApi/swap/v3/user/balance':
      case '/openApi/cswap/v1/user/balance':
      case '/openApi/contract/v1/balance':
        return ok([]);
      case '/openApi/spot/v2/quote/ticker':
        return ok(tickers);
      case '/openApi/account/v1/allAccountBalance':
        return refused(100500);
      default:
        return refused(100400);
    }
  });
  const result = await collectBingx(keys);
  assert.deepEqual(
    result.holdings.map((h) => [h.protocol, h.symbol, h.value]),
    [['Spot', 'BTC', 60000]],
  );
  assert.equal(result.reportedTotal, undefined);
  assert.deepEqual(result.warnings, ['total valuation could not be read: open-api.bingx.com → 100500: refused']);

  serve((url) =>
    url.pathname === '/openApi/spot/v1/account/balance' ? refused(100419) : ok({ balances: [], assets: [] }),
  );
  await assert.rejects(collectBingx(keys), /100419/);

  serve((url) => {
    if (url.pathname === '/openApi/spot/v1/account/balance') return ok({ balances: [] });
    if (url.pathname === '/openApi/cswap/v1/user/balance') return refused(100004);
    if (url.pathname === '/openApi/spot/v2/quote/ticker') return ok(tickers);
    if (url.pathname === '/openApi/account/v1/allAccountBalance') return ok([]);
    return url.pathname === '/openApi/fund/v1/account/balance' ? ok({ assets: [] }) : ok([]);
  });
  assert.deepEqual((await collectBingx(keys)).warnings, [
    'Coin-M Futures could not be read: open-api.bingx.com → 100004: refused',
  ]);
});
