import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { afterEach, test } from 'node:test';
import { checkGateKey, collectGate } from '../../src/sources/gate.ts';

const keys = {
  apiKey: 'c5dcfbf1f3a74e2b9d10a6f7c3e8b215',
  apiSecret: '4f1e9a7c2b6d8e0f3a5c7e9b1d3f5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f',
};
const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

type Answer = { status?: number; body: unknown };
const ok = (body: unknown): Answer => ({ body });
const refused = (label: string, status = 401): Answer => ({ status, body: { label, message: 'refused' } });

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

const listed = (perms: [string, boolean][], ip: string[] = []) => ({
  state: 1,
  mode: 1,
  key: 'c5dcfbf1f3a7*****',
  perms: perms.map(([name, read_only]) => ({ name, read_only })),
  ip_whitelist: ip,
});
const other = { ...listed([['spot', false]]), key: '52fd0035f665*****' };

test('the key is found among the main account keys and is signed with HMAC-SHA512', async () => {
  const calls = serve(() =>
    ok([
      other,
      listed(
        [
          ['spot', true],
          ['wallet', true],
        ],
        ['203.0.113.7'],
      ),
    ]),
  );
  assert.deepEqual(await checkGateKey(keys), { extra: [], ipRestricted: true });

  const [call] = calls;
  assert.equal(call!.url.href, 'https://api.gateio.ws/api/v4/account/main_keys');
  assert.equal(call!.headers.get('key'), keys.apiKey);
  const timestamp = call!.headers.get('timestamp')!;
  assert.match(timestamp, /^\d{10}$/);
  const body = createHash('sha512').update('').digest('hex');
  const expected = createHmac('sha512', keys.apiSecret)
    .update(`GET\n/api/v4/account/main_keys\n\n${body}\n${timestamp}`)
    .digest('hex');
  assert.equal(call!.headers.get('sign'), expected);
});

test('a key that can trade or move funds is refused with what it can do, and an unbound key is not IP-restricted', async () => {
  serve(() =>
    ok([
      listed([
        ['spot', false],
        ['wallet', false],
        ['futures', true],
      ]),
    ]),
  );
  assert.deepEqual(await checkGateKey(keys), { extra: ['spot trading', 'transfers'], ipRestricted: false });
});

test('a key whose permissions cannot be read is refused, and refusals are in plain words', async () => {
  serve(() => ok([other]));
  await assert.rejects(checkGateKey(keys), /did not list this key's permissions/);
  serve(() => refused('FORBIDDEN', 403));
  await assert.rejects(checkGateKey(keys), /did not list this key's permissions/);
  serve(() => refused('INVALID_SIGNATURE'));
  await assert.rejects(checkGateKey(keys), /the secret does not match it/);
  serve(() => refused('INVALID_KEY'));
  await assert.rejects(checkGateKey(keys), /Gate refused the key\. Check the API key and the secret/);
});

const tickers = [
  { currency_pair: 'BTC_USDT', last: '60000' },
  { currency_pair: 'GT_USDT', last: '20' },
  { currency_pair: 'SOL_USDC', last: '150' },
  { currency_pair: 'USDC_USDT', last: '1' },
  { currency_pair: 'ETH_USDT', last: '3000' },
];

function earn(url: URL): Answer | null {
  switch (url.pathname) {
    case '/api/v4/earn/uni/lends':
      assert.equal(url.searchParams.get('limit'), '100');
      return ok([{ currency: 'USDT', amount: '500', current_amount: '500', lent_amount: '0', frozen_amount: '0' }]);
    case '/api/v4/earn/fixed-term/user/lend':
      assert.equal(url.searchParams.get('order_type'), '1');
      return ok({
        code: 0,
        message: '',
        data: {
          list: [
            { asset: 'USDT', principal: '100', status: 1 },
            { asset: 'USDT', principal: '900', status: 2 },
          ],
          total: 2,
        },
      });
    case '/api/v4/earn/staking/assets':
      return ok([
        { pid: 1, mortgage_coin: 'GT', mortgage_amount: '5', type: 0 },
        { pid: 2, mortgage_coin: 'SOL', mortgage_amount: '3', type: 1 },
      ]);
    case '/api/v4/spot/tickers':
      return ok(tickers);
    case '/api/v4/wallet/total_balance':
      assert.equal(url.searchParams.get('currency'), 'USDT');
      return ok({ total: { currency: 'USDT', amount: '7580' }, details: {} });
    default:
      return null;
  }
}

test('a classic account reads Spot, Futures and Earn, and a futures account never opened is not a warning', async () => {
  serve((url) => {
    switch (url.pathname) {
      case '/api/v4/unified/accounts':
        return ok({ mode: 'classic', balances: {} });
      case '/api/v4/spot/accounts':
        return ok([
          { currency: 'BTC', available: '0.5', locked: '0.25' },
          { currency: 'GT', available: '10', locked: '0' },
        ]);
      case '/api/v4/futures/usdt/accounts':
        return ok({ currency: 'USDT', total: '1000', unrealised_pnl: '-40' });
      case '/api/v4/futures/btc/accounts':
        return refused('USER_NOT_FOUND', 400);
      default:
        return earn(url) ?? refused('NOT_FOUND', 404);
    }
  });

  const result = await collectGate(keys);
  assert.deepEqual(
    result.holdings.map((h) => [h.protocol, h.symbol, h.type, h.value]),
    [
      ['Spot', 'BTC', 'wallet', 45000],
      ['Spot', 'GT', 'wallet', 200],
      ['Futures', 'USDT', 'futures', 960],
      ['Earn', 'USDT', 'earn', 500],
      ['Earn', 'USDT', 'locked', 100],
      ['Earn', 'SOL', 'staked', 450],
    ],
  );
  assert.ok(result.holdings.every((h) => h.chain === 'gate'));
  assert.equal(result.reportedTotal, 7580);
  assert.deepEqual(result.warnings, []);
});

test('a unified account is read once, with isolated margin, without the Earn it lends as margin', async () => {
  const calls = serve((url) => {
    switch (url.pathname) {
      case '/api/v4/unified/accounts':
        return ok({
          mode: 'multi_currency',
          use_funding: true,
          balances: {
            BTC: { equity: '0.12', iso_balance: '0', funding: '0' },
            USDT: { equity: '1200', iso_balance: '300', funding: '500' },
            ETH: { equity: '-0.5', iso_balance: '0', funding: '0' },
          },
        });
      case '/api/v4/futures/btc/accounts':
        return refused('USER_NOT_FOUND', 400);
      default:
        return earn(url) ?? refused('NOT_FOUND', 404);
    }
  });

  const result = await collectGate(keys);
  assert.deepEqual(
    result.holdings.filter((h) => h.protocol === 'Unified').map((h) => [h.symbol, h.type, h.value]),
    [
      ['BTC', 'wallet', 7200],
      ['USDT', 'wallet', 1000],
      ['ETH', 'borrow', -1500],
    ],
  );
  const paths = calls.map((c) => c.url.pathname);
  assert.ok(!paths.includes('/api/v4/spot/accounts'), 'spot is part of the unified account');
  assert.ok(!paths.includes('/api/v4/futures/usdt/accounts'), 'USDT futures are part of the unified account');
});

test('Earn that cannot be read becomes a warning, and the main wallet failing fails the account', async () => {
  serve((url) => {
    switch (url.pathname) {
      case '/api/v4/unified/accounts':
        return refused('FORBIDDEN', 403);
      case '/api/v4/spot/accounts':
        return ok([{ currency: 'BTC', available: '1', locked: '0' }]);
      case '/api/v4/earn/uni/lends':
        return refused('FORBIDDEN', 403);
      case '/api/v4/futures/usdt/accounts':
      case '/api/v4/futures/btc/accounts':
        return refused('USER_NOT_FOUND', 400);
      default:
        return earn(url) ?? refused('NOT_FOUND', 404);
    }
  });
  const result = await collectGate(keys);
  assert.deepEqual(result.warnings, ['Earn (simple) could not be read: api.gateio.ws → FORBIDDEN: refused']);

  serve((url) => (url.pathname === '/api/v4/spot/accounts' ? refused('IP_FORBIDDEN') : refused('FORBIDDEN', 403)));
  await assert.rejects(collectGate(keys), /IP_FORBIDDEN/);
});
