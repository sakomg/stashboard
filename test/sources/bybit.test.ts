import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { afterEach, test } from 'node:test';
import { checkBybitKey, collectBybit } from '../../src/sources/bybit.ts';

const keys = { apiKey: 'AbCdEfGhIjKlMnOpQr', apiSecret: 'S'.repeat(36) };
const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

type Route = (url: URL, headers: Headers) => unknown;
const ok = (result: unknown) => ({ retCode: 0, retMsg: 'OK', result });
const refused = (retCode: number) => ({ retCode, retMsg: 'refused', result: {} });

function serve(route: Route): { url: URL; headers: Headers }[] {
  const calls: { url: URL; headers: Headers }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    calls.push({ url, headers });
    return new Response(JSON.stringify(route(url, headers)), { status: 200 });
  }) as typeof fetch;
  return calls;
}

test('the key is found on the regional site that issued it, and its read-only flag and IPs are read', async () => {
  const calls = serve((url) =>
    url.host === 'api.bybit.kz'
      ? ok({ readOnly: 1, ips: ['203.0.113.7'], permissions: { Wallet: ['AccountTransfer'], Earn: ['Earn'] } })
      : refused(10003),
  );
  assert.deepEqual(await checkBybitKey(keys), { extra: [], ipRestricted: true, host: 'api.bybit.kz' });

  const call = calls.find((c) => c.url.host === 'api.bybit.kz')!;
  const timestamp = call.headers.get('x-bapi-timestamp')!;
  const expected = createHmac('sha256', keys.apiSecret)
    .update(timestamp + keys.apiKey + '10000')
    .digest('hex');
  assert.equal(call.headers.get('x-bapi-sign'), expected);
  assert.equal(call.headers.get('x-bapi-api-key'), keys.apiKey);
});

test('a read-write key is refused with what it can do, and an unbound key is not IP-restricted', async () => {
  serve(() => ok({ readOnly: 0, ips: ['*'], permissions: { Spot: ['SpotTrade'], Wallet: ['Withdraw'], Options: [] } }));
  assert.deepEqual(await checkBybitKey({ ...keys, host: 'api.bybit.com' }), {
    extra: ['spot trading', 'withdrawals'],
    ipRestricted: false,
    host: 'api.bybit.com',
  });
});

test('a key Bybit does not know anywhere, or one bound to other IPs, is refused in plain words', async () => {
  serve(() => refused(10003));
  await assert.rejects(checkBybitKey(keys), /Bybit refused the key\. Check the API key and the secret/);
  serve((url) => (url.host === 'api.bybit.com' ? refused(10010) : refused(10003)));
  await assert.rejects(checkBybitKey(keys), /does not allow this server's IP address/);
});

test('Unified Trading, Funding and Earn are read, priced from spot tickers, and a missing Earn is a warning', async () => {
  serve((url) => {
    const path = url.pathname;
    if (path === '/v5/account/wallet-balance') {
      return ok({
        list: [
          {
            coin: [
              { coin: 'BTC', equity: '0.1', usdValue: '6000' },
              { coin: 'USDT', equity: '-50', usdValue: '-50' },
              { coin: 'XYZ', equity: '10', usdValue: '5' },
            ],
          },
        ],
      });
    }
    if (path === '/v5/asset/transfer/query-account-coins-balance') {
      assert.equal(url.searchParams.get('accountType'), 'FUND');
      return ok({ balance: [{ coin: 'ETH', walletBalance: '2', transferBalance: '2' }] });
    }
    if (path === '/v5/earn/position') {
      return url.searchParams.get('category') === 'FlexibleSaving'
        ? ok({ list: [{ coin: 'USDC', amount: '300' }] })
        : refused(10005);
    }
    if (path === '/v5/market/tickers') {
      return ok({
        list: [
          { symbol: 'BTCUSDT', lastPrice: '60000' },
          { symbol: 'ETHUSDT', lastPrice: '3000' },
          { symbol: 'USDCUSDT', lastPrice: '1' },
        ],
      });
    }
    if (path === '/v5/asset/asset-overview') return ok({ totalEquity: '12260' });
    throw new Error(`unexpected ${path}`);
  });

  const result = await collectBybit(keys);
  assert.deepEqual(
    result.holdings.map((h) => [h.protocol, h.symbol, h.type, h.value]),
    [
      ['Unified Trading', 'BTC', 'wallet', 6000],
      ['Unified Trading', 'USDT', 'borrow', -50],
      ['Unified Trading', 'XYZ', 'wallet', 5],
      ['Funding', 'ETH', 'wallet', 6000],
      ['Earn', 'USDC', 'earn', 300],
    ],
  );
  assert.ok(result.holdings.every((h) => h.chain === 'bybit'));
  assert.equal(result.reportedTotal, 12260);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]!, /^Earn \(on-chain\) could not be read: api\.bybit\.com → 10005/);
});
