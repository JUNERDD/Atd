import { cp, lstat, readlink, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FetchLimits } from './installer.js';
import { createBudget } from './limits.js';
import type { FetchedSource } from './fetch.js';

/** Directory names never copied into a revision: VCS metadata and installed dependencies. */
const EXCLUDED = new Set(['.git', 'node_modules']);

/** The warning a fetcher reports for a symlink it did not publish. */
export function droppedLinkWarning(relativePath: string): string {
  return `Dropped the symlink "${relativePath}" because it points outside the plugin.`;
}

/**
 * Copies `from` into `to` (which must not exist) within `limits` and returns the root-relative
 * POSIX paths of dropped symlinks. A relative symlink whose target, resolved from its own
 * folder, stays inside `from` is copied verbatim; absolute and escaping links are dropped so no
 * revision can point outside its root. Sockets, FIFOs and devices are skipped.
 */
export async function copyTree(from: string, to: string, limits: FetchLimits): Promise<string[]> {
  const budget = createBudget(limits);
  const dropped: string[] = [];
  await cp(from, to, {
    recursive: true,
    verbatimSymlinks: true,
    errorOnExist: true,
    force: false,
    async filter(source) {
      if (source !== from && EXCLUDED.has(path.basename(source))) return false;
      const stats = await lstat(source);
      if (stats.isDirectory()) return true;
      if (stats.isSymbolicLink()) {
        // An absolute target names the source location, never the published copy.
        const link = await readlink(source);
        const target = path.resolve(path.dirname(source), link);
        if (path.isAbsolute(link) || (target !== from && !target.startsWith(from + path.sep))) {
          dropped.push(path.relative(from, source).split(path.sep).join('/'));
          return false;
        }
      } else if (!stats.isFile()) return false;
      budget.add(stats.isFile() ? stats.size : 0);
      return true;
    },
  });
  return dropped.sort();
}

/** Copies a local plugin directory. The recorded path is the source's real absolute path. */
export async function fetchLocal(
  sourcePath: string,
  tree: string,
  limits: FetchLimits,
): Promise<FetchedSource> {
  let real: string;
  try {
    real = await realpath(path.resolve(sourcePath));
  } catch {
    throw new Error(`The plugin folder "${sourcePath}" does not exist.`);
  }
  if (!(await stat(real)).isDirectory()) {
    throw new Error(`The plugin source "${sourcePath}" is not a folder.`);
  }
  const dropped = await copyTree(real, tree, limits);
  return {
    source: { kind: 'local', path: real },
    resolved: {},
    fallbackName: path.basename(real),
    warnings: dropped.map(droppedLinkWarning),
  };
}
