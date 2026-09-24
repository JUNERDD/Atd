import { createHash, type Hash } from 'node:crypto';
import { lstat, readdir, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';

/** Finder metadata macOS drops into any directory it shows; never part of a skill's content. */
export const IGNORED_ENTRY = '.DS_Store';

/**
 * The content fingerprint of a skill directory: SHA-256 over every file, in the order of its
 * POSIX relative path, feeding the path, the byte length and the bytes (a symlink feeds its target
 * instead). Empty directories and `.DS_Store` do not count. Null when the directory is absent; a
 * non-directory at that path gets a fingerprint no shipped version can have.
 */
export async function fingerprintDir(dir: string): Promise<string | null> {
  let root;
  try {
    root = await lstat(dir);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  const hash = createHash('sha256');
  if (!root.isDirectory()) return hash.update(`not-a-directory\0${root.size}`).digest('hex');
  for (const relative of (await listFiles(dir, '')).sort()) await feed(hash, dir, relative);
  return hash.digest('hex');
}

/**
 * The content fingerprint of a role: SHA-256 of canonical JSON of its title and allows. Tool and
 * skill lists compare as sets, so their order does not count.
 */
export function roleFingerprint(role: {
  title: string;
  allows: { tools: readonly string[]; skills: readonly string[] };
}): string {
  const canonical = JSON.stringify({
    allows: { skills: [...role.allows.skills].sort(), tools: [...role.allows.tools].sort() },
    title: role.title,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

async function listFiles(root: string, relative: string): Promise<string[]> {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === IGNORED_ENTRY) continue;
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...(await listFiles(root, child)));
    else files.push(child);
  }
  return files;
}

async function feed(hash: Hash, root: string, relative: string): Promise<void> {
  const file = path.join(root, ...relative.split('/'));
  const info = await lstat(file);
  if (info.isSymbolicLink()) {
    hash.update(`${relative}\0link\0${await readlink(file)}\0`);
    return;
  }
  const bytes = await readFile(file);
  hash.update(`${relative}\0${bytes.length}\0`);
  hash.update(bytes);
}

export function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
