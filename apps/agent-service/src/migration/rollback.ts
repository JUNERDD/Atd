import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { servicePaths } from '../storage.js';
import { ManifestStore, completionMarker } from './manifest.js';

/**
 * Rollback guards. Rollback never deletes migrated service data and never
 * runs while the service owns the dataDir: the operator stops the service
 * first (lock free, no live pid), then rollback clears only the completion
 * marker and records the decision. The desktop resumes ownership by clearing
 * its own marker; the two hosts never write the same data concurrently.
 */
export function rollbackMarker(dataDir: string): string {
  return path.join(dataDir, 'migration.rolledback');
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Throws when a live service still owns the dataDir. */
export async function assertServiceStopped(dataDir: string): Promise<void> {
  const paths = servicePaths(path.resolve(dataDir));
  let raw: string;
  try {
    raw = await readFile(paths.lockFile, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  try {
    const lock = JSON.parse(raw) as { pid?: unknown };
    if (typeof lock.pid === 'number' && isAlive(lock.pid))
      throw new Error(`Service pid ${lock.pid} still owns ${paths.root}; stop it before rollback.`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Service pid')) throw error;
    // An unreadable lock is not a live owner; migration re-acquires it.
  }
}

/** True when the service has a completed migration marker. */
export async function isMigrationComplete(dataDir: string): Promise<boolean> {
  try {
    await stat(completionMarker(path.resolve(dataDir)));
    return true;
  } catch {
    return false;
  }
}

export interface RollbackResult {
  hadCompletion: boolean;
  manifestKept: boolean;
  marker: string;
}

/**
 * Rolls back to desktop ownership: requires a stopped service, clears the
 * completion marker, stamps completedAt=null in the manifest (domain records
 * stay as evidence), and writes a rollback marker. Migrated bytes are kept.
 */
export async function rollbackMigration(dataDir: string, reason: string): Promise<RollbackResult> {
  const root = path.resolve(dataDir);
  await assertServiceStopped(root);
  if (!reason.trim()) throw new Error('A rollback reason is required.');
  const hadCompletion = await isMigrationComplete(root);
  if (!hadCompletion) throw new Error('No completed migration to roll back.');
  await rm(completionMarker(root), { force: true });
  const manifest = await ManifestStore.read(root);
  if (manifest) {
    const store = await ManifestStore.load(root, manifest.serviceId, manifest.sourceRoot);
    await store.change((data) => {
      data.completedAt = null;
      if (data.notes.length < 50) data.notes.push(`Rolled back: ${reason.slice(0, 500)}`);
    });
  }
  const marker = rollbackMarker(root);
  await writeFile(
    marker,
    JSON.stringify({ at: new Date().toISOString(), reason: reason.slice(0, 2000) }),
    { mode: 0o600 },
  );
  return { hadCompletion, manifestKept: manifest !== null, marker };
}
