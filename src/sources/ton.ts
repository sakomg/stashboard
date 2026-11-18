import { setTimeout as sleep } from 'node:timers/promises';
import { getJson, HttpError } from '../lib/http.ts';
import type { CollectResult, Holding, LogoHint } from '../domain/types.ts';

const API = 'https://tonapi.io/v2';
const TON_LOGO = 'https://assets.dedust.io/images/ton.webp';

export const tonTiming = {
  minIntervalMs: 1100,
  retryPausesMs: [2000, 5000, 10000],
  priceReuseMs: 5 * 60_000,
};
let lastRequestAt = 0;
let gramRate: { price: number; at: number } | null = null;

export function resetTonState(): void {
  lastRequestAt = 0;
  gramRate = null;
}

type OnWait = (note: string) => void;

async function tonGet<T>(path: string, apiKey: string, onWait?: OnWait): Promise<T> {
  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequestAt + tonTiming.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      return await getJson<T>(`${API}${path}`, headers);
    } catch (err) {
      if (!(err instanceof HttpError) || err.status !== 429) throw err;
      const pause = tonTiming.retryPausesMs[attempt];
      if (pause === undefined) {
        throw new Error(
          apiKey
            ? 'TonAPI kept refusing requests. It is rate limiting this key'
            : 'TonAPI kept refusing requests. A TonAPI key in config.json allows more',
        );
      }
      onWait?.(`TonAPI asked to slow down. Trying again in ${pause / 1000} s`);
      await sleep(pause);
    } finally {
      lastRequestAt = Date.now();
    }
  }
}

async function gramPrice(apiKey: string, onWait?: OnWait): Promise<number | undefined> {
  if (gramRate && Date.now() - gramRate.at < tonTiming.priceReuseMs) return gramRate.price;
  const rates = await tonGet<{ rates: { TON?: { prices?: { USD?: number } } } }>(
    '/rates?tokens=ton&currencies=usd',
    apiKey,
    onWait,
  );
  const price = rates.rates.TON?.prices?.USD;
  if (price) gramRate = { price, at: Date.now() };
  return price;
}

interface JettonBalance {
  balance: string;
  price?: { prices?: { USD?: number } };
  jetton: { symbol: string; decimals: number; verification?: string; image?: string };
}

export async function collectTon(apiKey: string, address: string, onWait?: OnWait): Promise<CollectResult> {
  const holdings: Holding[] = [];
  const warnings: string[] = [];
  const logos: LogoHint[] = [{ kind: 'token', key: 'TON', url: TON_LOGO }];

  const account = await tonGet<{ balance: number }>(`/accounts/${address}`, apiKey, onWait);
  const gram = account.balance / 1e9;
  if (gram > 0) {
    const price = await gramPrice(apiKey, onWait);
    if (price) {
      holdings.push({
        chain: 'ton',
        protocol: null,
        symbol: 'GRAM',
        quantity: gram,
        price,
        value: gram * price,
        type: 'wallet',
      });
    } else {
      warnings.push(`no price for ${gram} GRAM`);
    }
  }

  const jettons = await tonGet<{ balances: JettonBalance[] }>(
    `/accounts/${address}/jettons?currencies=usd`,
    apiKey,
    onWait,
  );
  for (const j of jettons.balances) {
    if (j.jetton.verification !== 'whitelist' || j.balance === '0') continue;
    const quantity = Number(j.balance) / 10 ** j.jetton.decimals;
    const price = j.price?.prices?.USD;
    if (!price) {
      warnings.push(`no price for ${quantity} ${j.jetton.symbol}`);
      continue;
    }
    if (j.jetton.image) logos.push({ kind: 'token', key: j.jetton.symbol, url: j.jetton.image });
    holdings.push({
      chain: 'ton',
      protocol: null,
      symbol: j.jetton.symbol,
      quantity,
      price,
      value: quantity * price,
      type: 'wallet',
    });
  }

  return { holdings, warnings, logos };
}
