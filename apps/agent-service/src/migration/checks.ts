import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * Migration content checks: size caps, stability (quiesced source), hashes
 * and SQLite file-set consistency. Checks never mutate; importers call them
 * before and after copying so a retry can compare checksums idempotently.
 */
export const MAX_WORKSPACE_BYTES = 64 * 1024 * 1024;
export const MAX_SETTINGS_BYTES = 32 * 1024 * 1024;

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function hashFile(file: string): Promise<string> {
  return sha256(await readFile(file));
}

/** Two stats 250ms apart must agree; a live writer fails the migration copy. */
export async function assertStable(file: string): Promise<{ size: number; mtimeMs: number }> {
  const first = await stat(file);
  await new Promise((resolve) => setTimeout(resolve, 250));
  const second = await stat(file);
  if (first.size !== second.size || first.mtimeMs !== second.mtimeMs)
    throw new Error(`Source file changed during migration: ${file}`);
  return { size: second.size, mtimeMs: second.mtimeMs };
}

export async function assertUnderLimit(file: string, limit: number): Promise<number> {
  const info = await stat(file);
  if (info.size > limit) throw new Error(`Source file exceeds the migration limit: ${file}`);
  return info.size;
}

/** Lists files (not directories) directly under a directory, sorted. */
export async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * SQLite consistency verdict for a Hermes sessions.db file set. A WAL file
 * without its SHM sidecar (or sizes shifting under us) means the source was
 * still writing: refuse the copy rather than migrate a torn database. The
 * source must be paused+flushed (desktop marker) before memory migration.
 */
export async function checkSqliteSet(
  dir: string,
  base = 'sessions.db',
): Promise<{
  db: boolean;
  wal: boolean;
  shm: boolean;
  consistent: boolean;
  detail: string;
}> {
  const files = new Set(await listFiles(dir));
  const db = files.has(base);
  const wal = files.has(`${base}-wal`);
  const shm = files.has(`${base}-shm`);
  if (!db) return { db, wal, shm, consistent: !wal && !shm, detail: 'No database file.' };
  if (wal && !shm)
    return { db, wal, shm, consistent: false, detail: 'WAL present without SHM sidecar.' };
  try {
    await assertStable(path.join(dir, base));
    if (wal) await assertStable(path.join(dir, `${base}-wal`));
  } catch (error) {
    return {
      db,
      wal,
      shm,
      consistent: false,
      detail: error instanceof Error ? error.message : 'Database files are changing.',
    };
  }
  return { db, wal, shm, consistent: true, detail: 'File set is stable.' };
}

/** Canonical checksum over sorted `name:hash` pairs for a copied file set. */
export async function checksumDir(dir: string, names: string[]): Promise<string> {
  const parts: string[] = [];
  for (const name of [...names].sort())
    parts.push(`${name}:${await hashFile(path.join(dir, name))}`);
  return sha256(parts.join('\n'));
}
