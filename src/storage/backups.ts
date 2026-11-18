import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export function backupNow(db: DatabaseSync, reason: string, dir = process.env.DATA_DIR ?? 'data'): string {
  const folder = join(dir, 'backups');
  mkdirSync(folder, { recursive: true });
  const file = join(folder, `stashboard-${reason}-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  return file;
}

export function backupDaily(
  db: DatabaseSync,
  dir = process.env.DATA_DIR ?? 'data',
  keep = 14,
  now = new Date(),
): string | null {
  const folder = join(dir, 'backups');
  mkdirSync(folder, { recursive: true });
  const file = join(folder, `stashboard-${now.toISOString().slice(0, 10)}.db`);
  const existing = readdirSync(folder)
    .filter((f) => /^stashboard-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort();
  if (existing.includes(file.slice(folder.length + 1))) return null;
  db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
  for (const old of existing.slice(0, Math.max(0, existing.length + 1 - keep))) rmSync(join(folder, old));
  return file;
}

export function databaseCopy(db: DatabaseSync): Buffer {
  const folder = mkdtempSync(join(tmpdir(), 'stashboard-copy-'));
  const file = join(folder, 'stashboard.db');
  try {
    db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
    return readFileSync(file);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
