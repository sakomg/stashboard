// One collection run: reads every account and stores the result as a snapshot.
import type { DatabaseSync } from 'node:sqlite';
import type { Config } from './config.ts';
import { ensureExchangeAccount, finishSnapshot, listAccounts, saveOutcome, startSnapshot, type Account } from './db.ts';
import { noteLogos } from './logos.ts';
import { collectBinance } from './sources/binance.ts';
import { collectTon } from './sources/ton.ts';
import { collectZerion } from './sources/zerion.ts';
import type { CollectResult } from './types.ts';

function collectAccount(config: Config, account: Account): Promise<CollectResult> {
  switch (account.kind) {
    case 'binance':
      return collectBinance(config.binance);
    case 'evm':
    case 'solana':
      if (!config.zerion.apiKey) throw new Error('Zerion key is not set in config.json');
      return collectZerion(config.zerion.apiKey, account.address, account.kind);
    case 'ton':
      return collectTon(config.tonapi.apiKey, account.address);
  }
}

/** Collects all accounts. A failing account is recorded as an error and does not stop the others. */
export async function runCollection(db: DatabaseSync, config: Config): Promise<number> {
  if (config.binance.apiKey && config.binance.apiSecret) ensureExchangeAccount(db, 'binance', 'Binance');

  const snapshotId = startSnapshot(db);
  for (const account of listAccounts(db)) {
    try {
      const result = await collectAccount(config, account);
      saveOutcome(db, snapshotId, account.id, { status: 'ok', ...result });
      if (result.logos) noteLogos(db, result.logos);
    } catch (err) {
      saveOutcome(db, snapshotId, account.id, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  finishSnapshot(db, snapshotId);
  return snapshotId;
}
