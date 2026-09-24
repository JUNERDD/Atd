import { randomUUID } from 'node:crypto';
import { chmod, cp, lstat, mkdir, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { IGNORED_ENTRY, isMissing } from './fingerprint.js';

/**
 * Replaces `target` with a copy of `source` as a whole. The copy is staged in `workDir` (a dot
 * directory beside the catalog, so on the same filesystem and outside skill discovery), then two
 * renames swap it in: the current copy moves aside, the staged one takes its place. Any failure
 * leaves the current copy at `target`: a failed stage never touches it, and a failed swap renames
 * it back. Only after the swap succeeds is the old copy removed.
 */
export async function installDirAtomic(input: {
  source: string;
  target: string;
  workDir: string;
}): Promise<void> {
  await mkdir(input.workDir, { recursive: true });
  await mkdir(path.dirname(input.target), { recursive: true });
  const token = `${path.basename(input.target)}-${randomUUID()}`;
  const staged = path.join(input.workDir, `${token}.new`);
  const retired = path.join(input.workDir, `${token}.old`);
  try {
    await copyTree(input.source, staged);
  } catch (error) {
    await rm(staged, { recursive: true, force: true });
    throw error;
  }
  let movedAside = false;
  try {
    if (await present(input.target)) {
      await rename(input.target, retired);
      movedAside = true;
    }
    await rename(staged, input.target);
  } catch (error) {
    if (movedAside) await rollBack(retired, input.target, error);
    await rm(staged, { recursive: true, force: true });
    throw error;
  }
  if (movedAside) await rm(retired, { recursive: true, force: true });
}

/**
 * Copies `source` to a new `<backupRoot>/<name>-<UTC stamp>` directory and answers its path. A
 * name taken within the same millisecond gets a numeric suffix; nothing existing is overwritten.
 */
export async function backupDir(source: string, backupRoot: string, name: string): Promise<string> {
  await mkdir(backupRoot, { recursive: true });
  const base = path.join(backupRoot, `${name}-${utcStamp()}`);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const target = attempt ? `${base}-${attempt}` : base;
    if (await present(target)) continue;
    await cp(source, target, { recursive: true, errorOnExist: true, force: false });
    return target;
  }
  throw new Error(`No free backup name under ${backupRoot}.`);
}

/** Removes leftovers of an install the process did not finish (the caller holds the lock). */
export async function clearWorkDir(workDir: string): Promise<void> {
  await rm(workDir, { recursive: true, force: true });
}

/** A filename-safe UTC timestamp, e.g. `20260924T101530123Z`. */
export function utcStamp(date = new Date()): string {
  return date.toISOString().replaceAll('-', '').replaceAll(':', '').replace('.', '');
}

export async function present(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

/**
 * Copies a template tree. `cp` keeps the source modes, and a packaged app may ship its templates
 * read-only, so the copy is made owner-writable: the installed skill is the user's to edit.
 */
async function copyTree(source: string, target: string): Promise<void> {
  await cp(source, target, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter: (from) => path.basename(from) !== IGNORED_ENTRY,
  });
  await ownerWritable(target);
}

async function ownerWritable(target: string): Promise<void> {
  const info = await lstat(target);
  if (info.isSymbolicLink()) return;
  await chmod(target, info.mode | (info.isDirectory() ? 0o700 : 0o600));
  if (!info.isDirectory()) return;
  for (const entry of await readdir(target)) await ownerWritable(path.join(target, entry));
}

async function rollBack(retired: string, target: string, cause: unknown): Promise<void> {
  try {
    await rename(retired, target);
  } catch {
    const reason = cause instanceof Error ? cause.message : 'the install failed';
    throw new Error(
      `Built-in install failed (${reason}) and the previous copy could not be moved back; it is preserved at ${retired}.`,
    );
  }
}
