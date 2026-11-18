import type { DatabaseSync } from 'node:sqlite';

interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function addSubscription(db: DatabaseSync, userId: number, sub: Subscription, now = new Date()): void {
  db.prepare(
    'INSERT OR REPLACE INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(sub.endpoint, userId, sub.p256dh, sub.auth, now.toISOString());
}

export function removeSubscription(db: DatabaseSync, userId: number, endpoint: string): boolean {
  return (
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(endpoint, userId).changes > 0
  );
}

export function dropSubscription(db: DatabaseSync, endpoint: string): void {
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
}

export function dropAllSubscriptions(db: DatabaseSync): void {
  db.exec('DELETE FROM push_subscriptions');
}

export function subscriptionsOf(db: DatabaseSync, userId: number): Subscription[] {
  return db
    .prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? ORDER BY created_at')
    .all(userId) as unknown as Subscription[];
}

export function subscribedPeople(db: DatabaseSync): number[] {
  return (
    db.prepare('SELECT DISTINCT user_id FROM push_subscriptions ORDER BY user_id').all() as { user_id: number }[]
  ).map((r) => r.user_id);
}

export function notifiedTopics(db: DatabaseSync, userId: number): Map<string, string> {
  const rows = db.prepare('SELECT topic, since FROM notified WHERE user_id = ?').all(userId) as {
    topic: string;
    since: string;
  }[];
  return new Map(rows.map((r) => [r.topic, r.since]));
}

export function noteNotified(db: DatabaseSync, userId: number, topics: [string, string][]): void {
  const insert = db.prepare('INSERT OR REPLACE INTO notified (user_id, topic, since) VALUES (?, ?, ?)');
  for (const [topic, since] of topics) insert.run(userId, topic, since);
}
