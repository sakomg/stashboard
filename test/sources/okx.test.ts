import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { afterEach, test } from 'node:test';
import { checkOkxKey, collectOkx } from '../../src/sources/okx.ts';

const keys = {
  apiKey: '37c541a1-1234-4abc-9def-10fe7a038418',
  apiSecret: '22582BD0CFF14C41EDBF1AB98506286D',
  passphrase: 'Read only 1!',
};
const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

type Answer = { status?: number; body: unknown };
const ok = (data: unknown): Answer => ({ body: { code: '0', msg: '', data } });
const refused = (code: string, status = 401): Answer => ({ status, body: { code, msg: 'refused' } });

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

test('the key is found on the regional domain that issued it, and is signed with the passphrase', async () => {
  const calls = serve((url) =>
    url.host === 'eea.okx.com' ? ok([{ perm: 'read_only', ip: '203.0.113.7' }]) : refused('50119'),
  );
  assert.deepEqual(await checkOkxKey(keys), { extra: [], ipRestricted: true, host: 'eea.okx.com' });

  const call = calls.find((c) => c.url.host === 'eea.okx.com')!;
  const timestamp = call.headers.get('ok-access-timestamp')!;
  assert.match(timestamp, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  const expected = createHmac('sha256', keys.apiSecret)
    .update(`${timestamp}GET/api/v5/account/config`)
    .digest('base64');
  assert.equal(call.headers.get('ok-access-sign'), expected);
  assert.equal(call.headers.get('ok-access-passphrase'), keys.passphrase);
});

test('a key that can trade or withdraw is refused with what it can do, and an unbound key is not IP-restricted', async () => {
  serve(() => ok([{ perm: 'read_only,withdraw,trade', ip: '' }]));
  assert.deepEqual(await checkOkxKey({ ...keys, host: 'openapi.okx.com' }), {
    extra: ['withdrawals', 'trading'],
    ipRestricted: false,
    host: 'openapi.okx.com',
  });
});

test('a wrong passphrase or an unknown key is refused in plain words', async () => {
  serve((url) => (url.host === 'us.okx.com' ? refused('50105') : refused('50119')));
  await assert.rejects(checkOkxKey(keys), /the passphrase is wrong/);
  serve(() => refused('50119'));
  await assert.rejects(checkOkxKey(keys), /OKX refused the key\. Check the API key, the secret and the passphrase/);
});

test('Trading, Funding and Earn are read and priced from spot tickers', async () => {
  serve((url) => {
    switch (url.pathname) {
      case '/api/v5/account/balance':
        return ok([
          {
            totalEq: '0',
            details: [
              { ccy: 'BTC', eq: '0.1', eqUsd: '6000' },
              { ccy: 'USDT', eq: '-20', eqUsd: '-20' },
            ],
          },
        ]);
      case '/api/v5/asset/balances':
        return ok([{ ccy: 'OKB', bal: '10', availBal: '10', frozenBal: '0' }]);
      case '/api/v5/finance/savings/balance':
        return ok([{ ccy: 'USDT', amt: '500', earnings: '1' }]);
      case '/api/v5/finance/staking-defi/orders-active':
        return ok([{ ccy: 'SOL', state: '1', investData: [{ ccy: 'SOL', amt: '3' }] }]);
      case '/api/v5/market/tickers':
        assert.equal(url.searchParams.get('instType'), 'SPOT');
        return ok([
          { instId: 'BTC-USDT', last: '60000' },
          { instId: 'OKB-USDT', last: '50' },
          { instId: 'SOL-USDC', last: '150' },
          { instId: 'USDC-USDT', last: '1' },
        ]);
      case '/api/v5/asset/asset-valuation':
        assert.equal(url.searchParams.get('ccy'), 'USD');
        return ok([{ totalBal: '6930', details: {} }]);
      default:
        throw new Error(`unexpected ${url.pathname}`);
    }
  });

  const result = await collectOkx(keys);
  assert.deepEqual(
    result.holdings.map((h) => [h.protocol, h.symbol, h.type, h.value]),
    [
      ['Trading', 'BTC', 'wallet', 6000],
      ['Trading', 'USDT', 'borrow', -20],
      ['Funding', 'OKB', 'wallet', 500],
      ['Earn', 'USDT', 'earn', 500],
      ['Earn', 'SOL', 'staked', 450],
    ],
  );
  assert.ok(result.holdings.every((h) => h.chain === 'okx'));
  assert.equal(result.reportedTotal, 6930);
  assert.deepEqual(result.warnings, []);
});
