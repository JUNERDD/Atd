import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { PathEscapeError, type FsEntry, type ReadonlyFs } from '../ports.js';

function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * `ReadonlyFs` over a real directory. Every access realpaths the target and throws
 * `PathEscapeError` when it resolves outside `root` (symlinks included).
 */
export function createNodeFs(root: string): ReadonlyFs {
  /**
   * Resolves a root-relative path to a real absolute path inside the root, or null when nothing
   * exists there. The lexical check runs first so `../x` is an escape even when it is missing.
   */
  async function resolve(relative: string): Promise<string | null> {
    const realRoot = await realpath(root);
    const lexical = path.resolve(realRoot, ...relative.split('/').filter(Boolean));
    if (path.isAbsolute(relative) || !isInside(realRoot, lexical)) {
      throw new PathEscapeError(relative);
    }
    let real: string;
    try {
      real = await realpath(lexical);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
    if (!isInside(realRoot, real)) throw new PathEscapeError(relative);
    return real;
  }

  async function kindOf(real: string): Promise<FsEntry['kind'] | null> {
    const stats = await stat(real);
    if (stats.isDirectory()) return 'dir';
    return stats.isFile() ? 'file' : null;
  }

  return {
    async readText(relative) {
      const real = await resolve(relative);
      if (real === null) {
        throw Object.assign(new Error(`ENOENT: no such file "${relative}"`), { code: 'ENOENT' });
      }
      return readFile(real, 'utf8');
    },

    async list(relative) {
      const real = await resolve(relative);
      if (real === null) {
        throw Object.assign(new Error(`ENOENT: no such directory "${relative}"`), {
          code: 'ENOENT',
        });
      }
      const entries: FsEntry[] = [];
      for (const dirent of await readdir(real, { withFileTypes: true })) {
        if (dirent.isDirectory()) entries.push({ name: dirent.name, kind: 'dir' });
        else if (dirent.isFile()) entries.push({ name: dirent.name, kind: 'file' });
        else if (dirent.isSymbolicLink()) {
          // Reported by target kind; reading an escaping target later throws PathEscapeError.
          try {
            const kind = await kindOf(path.join(real, dirent.name));
            if (kind !== null) entries.push({ name: dirent.name, kind });
          } catch (error) {
            if (!isMissing(error)) throw error;
          }
        }
      }
      return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    },

    async stat(relative) {
      const real = await resolve(relative);
      return real === null ? null : kindOf(real);
    },
  };
}
