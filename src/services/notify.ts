import type { DatabaseSync } from 'node:sqlite';
import type { Asset } from '../domain/assets.ts';
import { accountsMessage, heatMessage, WELCOME, type Extreme, type Message } from '../domain/notices.ts';
import { newVapidKeys, sendPush, type PushTarget, type VapidKeys } from '../sources/webpush.ts';
import {
  addSubscription,
  dropAllSubscriptions,
  dropSubscription,
  getSetting,
  noteNotified,
  notifiedTopics,
  seal,
  setSetting,
  subscribedPeople,
  subscriptionsOf,
  unseal,
  vaultKey,
} from '../storage/index.ts';
import { portfolioView } from './view.ts';

const VAPID_SETTING = 'vapid_keys';
const DUST_USD = 1;
const EXTREMES: Extreme[] = ['overheated', 'cold'];

export interface NotifyOptions {
  resolveFor: (userId: number) => (symbol: string) => Asset;
  subject: string;
  staleAfterMs: number;
  now?: Date;
}

export function vapidKeys(db: DatabaseSync): VapidKeys {
  const sealed = getSetting(db, VAPID_SETTING);
  if (sealed) {
    try {
      return unseal<VapidKeys>(vaultKey(), sealed);
    } catch {
      dropAllSubscriptions(db);
    }
  }
  const keys = newVapidKeys();
  setSetting(db, VAPID_SETTING, seal(vaultKey(), keys));
  return keys;
}

interface Topic {
  topic: string;
  since: string;
  heat?: { zone: Extreme; key: string; score: number; share: number };
  account?: { label: string; error: string | null };
}

function topicsNow(db: DatabaseSync, userId: number, options: NotifyOptions): Topic[] {
  const now = options.now ?? new Date();
  const view = portfolioView(db, userId, options.resolveFor(userId), now);
  const topics: Topic[] = [];
  for (const a of view.assets) {
    const signal = a.signal;
    if (!signal?.since || signal.dismissed || Math.abs(a.value) < DUST_USD) continue;
    const zone = EXTREMES.find((z) => z === signal.zone);
    if (!zone) continue;
    topics.push({
      topic: `${zone}:${a.key}`,
      since: signal.since,
      heat: { zone, key: a.key, score: signal.score, share: a.share },
    });
  }
  for (const s of view.sources) {
    if (!s.stale || (s.collectedAt && now.getTime() - Date.parse(s.collectedAt) < options.staleAfterMs)) continue;
    topics.push({
      topic: `account:${s.id}`,
      since: s.collectedAt ?? 'never',
      account: { label: s.label, error: s.error },
    });
  }
  return topics;
}

function messagesFor(topics: Topic[]): Message[] {
  const messages: Message[] = [];
  for (const zone of EXTREMES) {
    const assets = topics.flatMap((t) => (t.heat?.zone === zone ? [t.heat] : []));
    if (assets.length > 0) messages.push(heatMessage(zone, assets));
  }
  const accounts = topics.flatMap((t) => (t.account ? [t.account] : []));
  if (accounts.length > 0) messages.push(accountsMessage(accounts));
  return messages;
}

async function deliver(
  db: DatabaseSync,
  target: PushTarget,
  messages: Message[],
  options: NotifyOptions,
): Promise<number> {
  const vapid = vapidKeys(db);
  let delivered = 0;
  for (const message of messages) {
    if ((await sendPush(target, { ...message, url: '/' }, vapid, options.subject)) === 'gone') {
      dropSubscription(db, target.endpoint);
      break;
    }
    delivered++;
  }
  return delivered;
}

const pairs = (topics: Topic[]): [string, string][] => topics.map((t) => [t.topic, t.since]);

export async function notifyPeople(
  db: DatabaseSync,
  options: NotifyOptions,
  warn: (err: unknown) => void,
): Promise<number> {
  let delivered = 0;
  for (const userId of subscribedPeople(db)) {
    const seen = notifiedTopics(db, userId);
    const fresh = topicsNow(db, userId, options).filter((t) => seen.get(t.topic) !== t.since);
    if (fresh.length === 0) continue;
    let sent = 0;
    for (const target of subscriptionsOf(db, userId)) {
      try {
        sent += await deliver(db, target, messagesFor(fresh), options);
      } catch (err) {
        warn(err);
      }
    }
    if (sent > 0) noteNotified(db, userId, pairs(fresh));
    delivered += sent;
  }
  return delivered;
}

export async function welcome(
  db: DatabaseSync,
  userId: number,
  target: PushTarget,
  options: NotifyOptions,
): Promise<void> {
  addSubscription(db, userId, target);
  noteNotified(db, userId, pairs(topicsNow(db, userId, options)));
  try {
    if ((await deliver(db, target, [WELCOME], options)) === 0) {
      throw new Error('This browser turned notifications down. Try turning them on again.');
    }
  } catch (err) {
    dropSubscription(db, target.endpoint);
    throw err;
  }
}

export const pushSubject = (domain: string): string => `https://${domain || 'localhost'}`;
