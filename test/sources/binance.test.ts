import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { collectBinance } from '../../src/sources/binance.ts';

const keys = { apiKey: 'Y7CCIAHOkey', apiSecret: 'secret' };
const original = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = original;
});

type Answer = { status?: number; body: unknown };
const refused: Answer = { status: 401, body: { code: -2015, msg: 'Invalid API-key, IP, or permissions for action' } };

function serve(wallets: Answer, extra: Record<string, Answer> = {}): string[] {
  const asked: string[] = [];
  const routes: Record<string, Answer> = {
    '/sapi/v1/asset/get-funding-asset': { body: [] },
    '/sapi/v1/simple-earn/flexible/position': { body: { rows: [], total: 0 } },
    '/sapi/v1/simple-earn/locked/position': { body: { rows: [], total: 0 } },
    '/api/v3/ticker/price': { body: [{ symbol: 'BTCUSDT', price: '60000' }] },
    '/api/v3/account': { body: { balances: [{ asset: 'BTC', free: '0.1', locked: '0' }] } },
    '/sapi/v1/asset/wallet/balance': wallets,
    '/sapi/v1/margin/account': refused,
    '/fapi/v3/account': refused,
    '/dapi/v1/account': refused,
    ...extra,
  };
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    asked.push(url.pathname);
    const { status = 200, body } = routes[url.pathname] ?? { status: 404, body: {} };
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return asked;
}

const wallet = (walletName: string, balance: string, activate = true) => ({ activate, balance, walletName });

test('margin and futures that Binance lists as empty are not asked for, so an account without them reads clean', async () => {
  const asked = serve({
    body: [
      wallet('Spot', '6000'),
      wallet('Cross Margin', '0'),
      wallet('USDⓈ-M Futures', '0', false),
      wallet('COIN-M Futures', '0', false),
    ],
  });
  const result = await collectBinance(keys);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.reportedTotal, 6000);
  assert.deepEqual(
    result.holdings.map((h) => [h.protocol, h.symbol, h.value]),
    [['Spot', 'BTC', 6000]],
  );
  for (const path of ['/sapi/v1/margin/account', '/fapi/v3/account', '/dapi/v1/account']) {
    assert.ok(!asked.includes(path), path);
  }
});

test('futures that hold money but are hidden from the key say to make a new key, and wallets missing from the list are read', async () => {
  serve(
    { body: [wallet('Spot', '6000'), wallet('Cross Margin', '0'), wallet('USDⓈ-M Futures', '50')] },
    {
      '/dapi/v1/account': {
        body: { assets: [{ asset: 'BTC', walletBalance: '0.01', unrealizedProfit: '0.001' }] },
      },
    },
  );
  const result = await collectBinance(keys);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]!, /^USDⓈ-M Futures could not be read: Binance does not show futures to this key\./);
  assert.match(result.warnings[0]!, /Make a new read-only key and replace this one in Accounts\.$/);
  const coinM = result.holdings.find((h) => h.protocol === 'COIN-M Futures');
  assert.equal(coinM?.quantity, 0.011);
});

test('without the wallet list every wallet is read as before, and the failures stay warnings', async () => {
  serve({ status: 500, body: {} });
  const result = await collectBinance(keys);
  assert.equal(result.reportedTotal, undefined);
  assert.deepEqual(
    result.warnings.map((w) => w.split(':')[0]),
    [
      'total valuation could not be read',
      'Cross Margin could not be read',
      'USDⓈ-M Futures could not be read',
      'COIN-M Futures could not be read',
    ],
  );
});
