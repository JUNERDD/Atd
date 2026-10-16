import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

/** Missing files are expected; denied access and other I/O errors must stop the import. */
export async function exists(file: string): Promise<boolean> {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}

/** Resolves existing ancestors too, so a missing target under a symlink cannot alias production. */
export async function canonical(file: string): Promise<string> {
  if (await exists(file)) return realpath(file);
  const parent = path.dirname(file);
  if (parent === file) throw new Error('The import directory could not be resolved.');
  return path.join(await canonical(parent), path.basename(file));
}

function contains(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

/** Refuses both aliases and nested roots: backups and imported files can never write into source. */
export async function assertSeparate(source: string[], target: string[]): Promise<void> {
  const from = await Promise.all(source.map(canonical));
  const to = await Promise.all(target.map(canonical));
  if (from.some((a) => to.some((b) => contains(a, b) || contains(b, a))))
    throw new TypeError('Development sync requires separate source and development directories.');
}

/** Do not preserve links that would let the development copy edit files in the source profile. */
export async function assertCopyable(file: string): Promise<void> {
  const info = await lstat(file);
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
    throw new TypeError('Development sync cannot copy symbolic links or special files.');
  if (info.isDirectory())
    for (const name of await readdir(file)) await assertCopyable(path.join(file, name));
}
