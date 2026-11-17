import { createHmac } from 'node:crypto';
import { errorText } from '../lib/errors.ts';
import { getJson, HttpError } from '../lib/http.ts';
import { readWallets, toHoldings, type Balance, type ExchangeKeys, type KeyCheck } from '../domain/exchange.ts';
import type { CollectResult } from '../domain/types.ts';

const OKX_HOSTS = ['openapi.okx.com', 'eea.okx.com', 'us.okx.com'];

const UNKNOWN_KEY = new Set(['50111', '50119']);

const REFUSED: Record<string, string> = {
  '50102': "OKX refused the request: this server's clock is off. Sync it and try again.",
  '50105': 'OKX refused the key: the passphrase is wrong.',
  '50110': "OKX refused the key: it does not allow this server's IP address.",
  '50113': 'OKX refused the key: the secret does not match it.',
};

class OkxError extends Error {
  readonly code: string;

  constructor(host: string, code: string, message: string) {
    super(`${host} → ${code}: ${message}`);
    this.code = code;
  }
}

interface Reply<T> {
  code: string;
  msg: string;
  data: T;
}

const hostOf = (keys: ExchangeKeys): string => keys.host ?? OKX_HOSTS[0]!;

async function request<T>(host: string, path: string, headers: Record<string, string> = {}): Promise<T> {
  let reply: Reply<T>;
  try {
    reply = await getJson<Reply<T>>(`https://${host}${path}`, headers);
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    let body: Partial<Reply<T>> = {};
    try {
      body = JSON.parse(err.body) as Partial<Reply<T>>;
    } catch {
      throw err;
    }
    if (!body.code) throw err;
    throw new OkxError(host, body.code, body.msg ?? '');
  }
  if (reply.code !== '0') throw new OkxError(host, reply.code, reply.msg);
  return reply.data;
}

function okxSigned<T>(keys: ExchangeKeys, path: string, host = hostOf(keys)): Promise<T> {
  const timestamp = new Date().toISOString();
  const sign = createHmac('sha256', keys.apiSecret)
    .update(timestamp + 'GET' + path)
    .digest('base64');
  return request<T>(host, path, {
    'OK-ACCESS-KEY': keys.apiKey,
    'OK-ACCESS-SIGN': sign,
    'OK-ACCESS-TIMESTAMP': timestamp,
    'OK-ACCESS-PASSPHRASE': keys.passphrase ?? '',
  });
}

const PERMISSIONS: Record<string, string> = { trade: 'trading', withdraw: 'withdrawals' };

const unknownKey = (err: unknown): boolean => err instanceof OkxError && UNKNOWN_KEY.has(err.code);

export async function checkOkxKey(keys: ExchangeKeys): Promise<KeyCheck> {
  const hosts = keys.host ? [keys.host] : OKX_HOSTS;
  const answers = await Promise.allSettled(
    hosts.map((host) => okxSigned<{ perm?: string; ip?: string }[]>(keys, '/api/v5/account/config', host)),
  );
  for (const [i, answer] of answers.entries()) {
    if (answer.status !== 'fulfilled') continue;
    const config = answer.value[0] ?? {};
    const extra = (config.perm ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p && p !== 'read_only')
      .map((p) => PERMISSIONS[p] ?? p);
    return { extra, ipRestricted: Boolean(config.ip?.trim()), host: hosts[i] };
  }
  const errors = answers.map((a) => (a.status === 'rejected' ? a.reason : null));
  const known = errors.find((err) => err instanceof OkxError && REFUSED[err.code]);
  if (known instanceof OkxError) throw new Error(REFUSED[known.code]);
  const other = errors.find((err) => !unknownKey(err));
  if (other) throw other instanceof Error ? other : new Error(errorText(other));
  throw new Error(
    "OKX refused the key. Check the API key, the secret and the passphrase, and that the key allows this server's IP address.",
  );
}

export async function pingOkx(): Promise<string> {
  await request(OKX_HOSTS[0]!, '/api/v5/public/time');
  return 'market API is reachable from this IP';
}

const num = (value: string | undefined): number => Number(value || 0);

export async function collectOkx(keys: ExchangeKeys): Promise<CollectResult> {
  const host = hostOf(keys);
  const warnings: string[] = [];

  const trading = await okxSigned<{ details: { ccy: string; eq: string; eqUsd: string }[] }[]>(
    keys,
    '/api/v5/account/balance',
  );
  const balances: Balance[] = trading.flatMap((account) =>
    account.details.map((d) => ({
      wallet: 'Trading',
      type: 'wallet' as const,
      asset: d.ccy,
      quantity: num(d.eq),
      usd: num(d.eqUsd),
    })),
  );

  const funding = async (): Promise<Balance[]> => {
    const rows = await okxSigned<{ ccy: string; bal: string }[]>(keys, '/api/v5/asset/balances');
    return rows.map((r) => ({ wallet: 'Funding', type: 'wallet', asset: r.ccy, quantity: num(r.bal) }));
  };
  const savings = async (): Promise<Balance[]> => {
    const rows = await okxSigned<{ ccy: string; amt: string }[]>(keys, '/api/v5/finance/savings/balance');
    return rows.map((r) => ({ wallet: 'Earn', type: 'earn', asset: r.ccy, quantity: num(r.amt) }));
  };
  const onChain = async (): Promise<Balance[]> => {
    const orders = await okxSigned<{ investData?: { ccy: string; amt: string }[] }[]>(
      keys,
      '/api/v5/finance/staking-defi/orders-active',
    );
    return orders.flatMap((o) =>
      (o.investData ?? []).map((d) => ({
        wallet: 'Earn',
        type: 'staked' as const,
        asset: d.ccy,
        quantity: num(d.amt),
      })),
    );
  };
  balances.push(
    ...(await readWallets(
      [
        ['Funding', funding],
        ['Earn (simple)', savings],
        ['Earn (on-chain)', onChain],
      ],
      warnings,
    )),
  );

  const tickers = await request<{ instId: string; last: string }[]>(host, '/api/v5/market/tickers?instType=SPOT');
  const priced = toHoldings('okx', balances, new Map(tickers.map((t) => [t.instId.replace('-', ''), Number(t.last)])));
  warnings.push(...priced.warnings);

  let reportedTotal: number | undefined;
  try {
    const [valuation] = await okxSigned<{ totalBal: string }[]>(keys, '/api/v5/asset/asset-valuation?ccy=USD');
    if (valuation) reportedTotal = Number(valuation.totalBal);
  } catch (err) {
    warnings.push(`total valuation could not be read: ${errorText(err)}`);
  }

  return { holdings: priced.holdings, warnings, reportedTotal };
}
