// TonAPI: TON balance and whitelisted jettons of one wallet.
import { getJson } from '../http.ts';
import type { CollectResult, Holding } from '../types.ts';

const API = 'https://tonapi.io/v2';

interface JettonBalance {
  balance: string;
  price?: { prices?: { USD?: number } };
  jetton: { symbol: string; decimals: number; verification?: string };
}

export async function collectTon(apiKey: string, address: string): Promise<CollectResult> {
  // TonAPI also answers without a key, with a much lower rate limit.
  const headers: Record<string, string> = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
  const holdings: Holding[] = [];
  const warnings: string[] = [];

  const account = await getJson<{ balance: number }>(`${API}/accounts/${address}`, headers);
  const rates = await getJson<{ rates: { TON?: { prices?: { USD?: number } } } }>(
    `${API}/rates?tokens=ton&currencies=usd`,
    headers,
  );
  const tonPrice = rates.rates.TON?.prices?.USD;
  const ton = account.balance / 1e9;
  if (ton > 0) {
    if (tonPrice) {
      holdings.push({
        chain: 'ton',
        protocol: null,
        symbol: 'TON',
        quantity: ton,
        price: tonPrice,
        value: ton * tonPrice,
        type: 'wallet',
      });
    } else {
      warnings.push(`no price for ${ton} TON`);
    }
  }

  const jettons = await getJson<{ balances: JettonBalance[] }>(
    `${API}/accounts/${address}/jettons?currencies=usd`,
    headers,
  );
  for (const j of jettons.balances) {
    // Anyone can send a jetton to any wallet; only whitelisted ones count, the rest is mostly spam.
    if (j.jetton.verification !== 'whitelist' || j.balance === '0') continue;
    const quantity = Number(j.balance) / 10 ** j.jetton.decimals;
    const price = j.price?.prices?.USD;
    if (!price) {
      warnings.push(`no price for ${quantity} ${j.jetton.symbol}`);
      continue;
    }
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

  return { holdings, warnings };
}
