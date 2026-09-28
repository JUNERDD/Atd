import { createHash } from 'node:crypto';
import { readdir, readFile, readlink } from 'node:fs/promises';
import path from 'node:path';

interface TreeEntry {
  path: string;
  kind: 'file' | 'symlink';
  absolute: string;
}

async function collect(root: string, relative: string, out: TreeEntry[]): Promise<void> {
  const directory = path.join(root, relative);
  for (const dirent of await readdir(directory, { withFileTypes: true })) {
    const child = relative === '' ? dirent.name : `${relative}/${dirent.name}`;
    const absolute = path.join(directory, dirent.name);
    if (dirent.isDirectory()) await collect(root, child, out);
    else if (dirent.isFile()) out.push({ path: child, kind: 'file', absolute });
    else if (dirent.isSymbolicLink()) out.push({ path: child, kind: 'symlink', absolute });
  }
}

/**
 * Content hash of a staged tree: the first 32 hex characters of SHA-256 over every file and
 * symlink sorted by relative POSIX path. Each entry contributes its path, a NUL, its kind and
 * byte length (so adjacent entries cannot run together), a NUL, then its bytes (a symlink
 * contributes its target). Empty directories and file modes do not affect the revision.
 */
export async function hashTree(root: string): Promise<string> {
  const entries: TreeEntry[] = [];
  await collect(root, '', entries);
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hash = createHash('sha256');
  for (const entry of entries) {
    const bytes =
      entry.kind === 'file'
        ? await readFile(entry.absolute)
        : Buffer.from(await readlink(entry.absolute), 'utf8');
    hash.update(`${entry.path}\0${entry.kind}:${bytes.length}\0`, 'utf8');
    hash.update(bytes);
  }
  return hash.digest('hex').slice(0, 32);
}
