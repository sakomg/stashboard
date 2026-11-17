import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { base32Encode } from '../auth/index.ts';
import { createResolver, loadAssetRules, type Asset, type Learned } from '../domain/assets.ts';
import { loadConfig, type Config } from '../lib/config.ts';
import { categoryNames, loadLearned, manualCategories } from '../services/categories.ts';
import { adminClaimed, openDb } from '../storage/index.ts';

export interface Context {
  config: Config;
  db: DatabaseSync;
  demo: boolean;
  host: string;
  port: number;
  local: boolean;
  root: URL;
  categories: string[];
  learned: Learned;
  resolve: (symbol: string) => Asset;
  resolveFor: (userId: number) => (symbol: string) => Asset;
  auth: { claimed: boolean; setupCode: string | null };
}

interface ContextOptions {
  config?: Config;
  db?: DatabaseSync;
  env?: NodeJS.ProcessEnv;
}

export function createContext({
  config = loadConfig(),
  db = openDb(),
  env = process.env,
}: ContextOptions = {}): Context {
  const host = env.HOST ?? '127.0.0.1';
  const rules = loadAssetRules();
  const learned = loadLearned(db);
  const claimed = adminClaimed(db);
  return {
    config,
    db,
    demo: env.DEMO === '1',
    host,
    port: Number(env.PORT ?? 8787),
    local: ['127.0.0.1', 'localhost', '::1'].includes(host) && env.REQUIRE_LOGIN !== '1',
    root: new URL('../../', import.meta.url),
    categories: categoryNames(rules),
    learned,
    resolve: createResolver(rules, learned),
    resolveFor: (userId) => createResolver(rules, { manual: manualCategories(db, userId), auto: learned.auto }),
    auth: { claimed, setupCode: claimed ? null : base32Encode(randomBytes(8)).slice(0, 12) },
  };
}

export const formatSetupCode = (code: string): string => code.match(/.{4}/g)!.join('-');
