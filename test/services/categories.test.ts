import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createResolver, loadAssetRules } from '../../src/domain/assets.ts';
import {
  categoryFromTags,
  categoryNames,
  loadLearned,
  manualCategories,
  setManualCategory,
} from '../../src/services/categories.ts';
import { ADMIN_ID, addUser, openDb } from '../../src/storage/index.ts';

const rules = loadAssetRules();
const known = categoryNames(rules);

test('coin tags map onto the dashboard categories, the specific reading first', () => {
  assert.equal(categoryFromTags(['Meme', 'Cat-Themed', 'Robinhood Ecosystem'], known), 'Memes');
  assert.equal(categoryFromTags(['Solana Ecosystem', 'Solana Meme'], known), 'Memes');
  assert.equal(categoryFromTags(['Layer 2 (L2)', 'Base Meme'], known), 'Memes');
  assert.equal(categoryFromTags(['Smart Contract Platform', 'Layer 1 (L1)'], known), 'L1');
  assert.equal(categoryFromTags(['SocialFi', 'Layer 2 (L2)', 'Governance'], known), 'L2');
  assert.equal(categoryFromTags(['Stablecoins', 'USD Stablecoin'], known), 'Stablecoins');
  assert.equal(categoryFromTags(['Launchpad', 'Robinhood Ecosystem'], known), 'DeFi');
  assert.equal(categoryFromTags(['Decentralized Exchange (DEX)'], known), 'DeFi');
  assert.equal(categoryFromTags(['NFT', 'Smart Contract Platform', 'Coinbase 50 Index'], known), 'L1');
});

test('tags that say nothing about the kind of asset give no category', () => {
  assert.equal(categoryFromTags(['Solana Ecosystem', 'Made in USA'], known), null);
  assert.equal(categoryFromTags(['Gaming (GameFi)', 'IP Meme', 'Coinbase 50 Index'], known), null);
  assert.equal(categoryFromTags([], known), null);
});

test('a category chosen by hand wins, then the rules, then a looked-up one', () => {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  const learned = loadLearned(db);
  const resolverOf = (userId: number) =>
    createResolver(rules, { manual: manualCategories(db, userId), auto: learned.auto });
  assert.deepEqual(resolverOf(ADMIN_ID)('PONS'), { key: 'PONS', category: 'Other' });

  db.prepare("INSERT INTO asset_categories (key, auto) VALUES ('PONS', 'DeFi'), ('ARB', 'DeFi')").run();
  loadLearned(db, learned);
  assert.deepEqual(resolverOf(ADMIN_ID)('PONS'), { key: 'PONS', category: 'DeFi', source: 'auto' });
  assert.deepEqual(resolverOf(ADMIN_ID)('ARB'), { key: 'ARB', category: 'L2' });

  setManualCategory(db, ADMIN_ID, 'PONS', 'Memes');
  setManualCategory(db, ADMIN_ID, 'ARB', 'DeFi');
  setManualCategory(db, ADMIN_ID, 'ETH', 'L1');
  const resolve = resolverOf(ADMIN_ID);
  assert.deepEqual(resolve('PONS'), { key: 'PONS', category: 'Memes', source: 'manual' });
  assert.deepEqual(resolve('ARB'), { key: 'ARB', category: 'DeFi', source: 'manual' });
  assert.deepEqual(resolve('aEthWETH'), { key: 'ETH', category: 'L1', source: 'manual' });

  setManualCategory(db, ADMIN_ID, 'PONS', null);
  assert.deepEqual(resolverOf(ADMIN_ID)('PONS'), { key: 'PONS', category: 'DeFi', source: 'auto' });
});

test("a category chosen by hand is one person's choice and changes nothing for the others", () => {
  const db = openDb(mkdtempSync(join(tmpdir(), 'stashboard-test-')));
  const friend = addUser(db, { name: 'Kate', passwordHash: 'h', totpSecret: 'S', totpStep: 0 });
  setManualCategory(db, ADMIN_ID, 'ARB', 'DeFi');
  setManualCategory(db, friend.id, 'ARB', 'Memes');
  const resolverOf = (userId: number) =>
    createResolver(rules, { manual: manualCategories(db, userId), auto: new Map() });
  assert.equal(resolverOf(ADMIN_ID)('ARB').category, 'DeFi');
  assert.equal(resolverOf(friend.id)('ARB').category, 'Memes');
  assert.equal(createResolver(rules, loadLearned(db))('ARB').category, 'L2', 'collection ignores choices by hand');
});
