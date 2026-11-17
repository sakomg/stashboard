import { getJson } from '../lib/http.ts';
import type { CollectResult, Holding, LogoHint } from '../domain/types.ts';

const API = 'https://tonapi.io/v2';
const TON_LOGO = 'https://assets.dedust.io/images/ton.webp';

interface JettonBalance {
  balance: string;
  price?: { prices?: { USD?: number } };
  jetton: { symbol: string; decimals: number; verification?: string; image?: string };
}

export async function collectTon(apiKey: string, address: string): Promise<CollectResult> {
  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  const holdings: Holding[] = [];
  const warnings: string[] = [];
  const logos: LogoHint[] = [{ kind: 'token', key: 'TON', url: TON_LOGO }];

  const account = await getJson<{ balance: number }>(`${API}/accounts/${address}`, headers);
  const rates = await getJson<{ rates: { TON?: { prices?: { USD?: number } } } }>(
    `${API}/rates?tokens=ton&currencies=usd`,
    headers,
  );
  const gramPrice = rates.rates.TON?.prices?.USD;
  const gram = account.balance / 1e9;
  if (gram > 0) {
    if (gramPrice) {
      holdings.push({
        chain: 'ton',
        protocol: null,
        symbol: 'GRAM',
        quantity: gram,
        price: gramPrice,
        value: gram * gramPrice,
        type: 'wallet',
      });
    } else {
      warnings.push(`no price for ${gram} GRAM`);
    }
  }

  const jettons = await getJson<{ balances: JettonBalance[] }>(
    `${API}/accounts/${address}/jettons?currencies=usd`,
    headers,
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
