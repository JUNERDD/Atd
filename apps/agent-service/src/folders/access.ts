import path from 'node:path';
import { inside, realAncestorPath, resolveToolPath } from '../service-fs.js';

/**
 * Whether a read-only tool's `path` argument, resolved as pi resolves it, lands in one of the
 * run's granted folders, which it may then read without approval. `folders` are the realpaths the
 * run started with, compared as they are: a link inside a folder that leads elsewhere, or a folder
 * replaced by a link since the run started, does not count. The service data dir never counts,
 * even under a granted folder that holds it; for a recursive search (`recursive`), neither does a
 * path that holds the data dir. Those calls keep the usual approval.
 */
export async function inGrantedFolder(
  folders: readonly string[],
  dataDir: string,
  cwd: string,
  rawPath: string,
  recursive: boolean,
): Promise<boolean> {
  if (!folders.length) return false;
  const real = await realAncestorPath(resolveToolPath(cwd, rawPath));
  if (!folders.some((folder) => inside(folder, real))) return false;
  const data = await realAncestorPath(path.resolve(dataDir));
  return !inside(data, real) && !(recursive && inside(real, data));
}
