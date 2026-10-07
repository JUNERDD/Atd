import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

/**
 * The dependency cache, under the service's protected apps root (`apps/.cache/deps`), and how
 * long it keeps what:
 *
 * ```
 * config/              user-npmrc and global-npmrc, empty (npm.ts)
 * npm/                 npm's cache of packuments and tarballs, shared by every install
 * trees/<key>/         package.json, package-lock.json, node_modules/ and tree.json (store.ts)
 * trees/.tmp-<uuid>/   an install in progress
 * .trash-<uuid>/       what pruning moved out of the way and is deleting
 * ```
 *
 * A sealed tree is never changed: the builder and `tsc` only read it, and the backend never sees
 * it (its bundle is self-contained), so pruning is always safe: a version keeps the lockfile its
 * tree is rebuilt from, offline from npm's cache while that still holds the tarballs.
 */

export const TREE_FILE = 'tree.json';
/** A tree unused this long is removed. */
export const TREE_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
/** Trees beyond this total are removed, least recently used first. */
export const MAX_TREES_BYTES = 2 * 1024 * 1024 * 1024;
/** npm's cache is removed whole once it grows past this. */
export const MAX_NPM_CACHE_BYTES = 1024 * 1024 * 1024;

const TreeInfoSchema = Type.Object(
  {
    key: Type.String(),
    npm: Type.String(),
    policy: Type.Integer(),
    packages: Type.Integer({ minimum: 0 }),
    files: Type.Integer({ minimum: 0 }),
    bytes: Type.Integer({ minimum: 0 }),
    createdAt: Type.String(),
  },
  { additionalProperties: false },
);
/** `tree.json`, written last when a tree is sealed; its mtime is the tree's last use. */
export type TreeInfo = Static<typeof TreeInfoSchema>;

/** A sealed tree's `tree.json`, or null for a directory that is not the sealed tree `key`. */
export async function readTreeInfo(dir: string, key: string): Promise<TreeInfo | null> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(path.join(dir, TREE_FILE), 'utf8'));
    return Value.Check(TreeInfoSchema, value) && value.key === key ? value : null;
  } catch {
    return null;
  }
}

/**
 * Per process: trees in use (leased by builds), and directories npm is writing (an install's
 * temporary tree, npm's cache while npm runs), which pruning leaves alone; and one queue per
 * cache that orders a build's look-up of a tree against pruning's removal of it. Across
 * processes, the atomic seal keeps every tree whole.
 */
const leases = new Map<string, number>();
const busy = new Map<string, number>();
const queues = new Map<string, Promise<unknown>>();

/** Adds one hold on `dir`; the returned function releases it, once. */
function hold(counts: Map<string, number>, dir: string): () => void {
  counts.set(dir, (counts.get(dir) ?? 0) + 1);
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    const left = (counts.get(dir) ?? 1) - 1;
    if (left > 0) counts.set(dir, left);
    else counts.delete(dir);
  };
}

/** Keeps pruning off tree `dir` until released. */
export const leaseTree = (dir: string) => hold(leases, dir);
/** Keeps pruning off `dir` while npm writes it. */
export const markBusy = (dir: string) => hold(busy, dir);

/** Runs `task` once the cache's earlier queued tasks settled. */
export function exclusive<T>(cache: string, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(cache) ?? Promise.resolve()).catch(() => undefined).then(task);
  queues.set(cache, run);
  void run
    .finally(() => {
      if (queues.get(cache) === run) queues.delete(cache);
    })
    .catch(() => undefined);
  return run;
}

const isMissing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

async function entries(dir: string): Promise<string[]> {
  return fs.readdir(dir).catch((error: unknown) => {
    if (isMissing(error)) return [];
    throw error;
  });
}

/** The bytes of the regular files under `dir`, without following links; 0 when it is missing. */
async function directoryBytes(dir: string): Promise<number> {
  let total = 0;
  const files = await fs
    .readdir(dir, { recursive: true, withFileTypes: true })
    .catch((error: unknown) => {
      if (isMissing(error)) return [];
      throw error;
    });
  for (const file of files.filter((entry) => entry.isFile()))
    total += (await fs.lstat(path.join(file.parentPath, file.name))).size;
  return total;
}

export interface PruneResult {
  removedTrees: number;
  keptTrees: number;
  removedNpmCache: boolean;
}

/**
 * Removes what the cache no longer needs: leftovers of interrupted installs and pruning, trees
 * unused for `TREE_IDLE_MS`, then the least recently used trees until the rest fit
 * `MAX_TREES_BYTES`, and npm's cache when it outgrew `MAX_NPM_CACHE_BYTES`. Trees in use and
 * directories npm is writing stay. Each removal is a rename out of the way under the cache's
 * queue, so a build never finds a tree that is going; the deleting happens after.
 */
export async function pruneDependencyCache(cacheDir: string): Promise<PruneResult> {
  const cache = await fs.realpath(cacheDir).catch((error: unknown) => {
    if (isMissing(error)) return null;
    throw error;
  });
  if (cache === null) return { removedTrees: 0, keptTrees: 0, removedNpmCache: false };
  const npmCache = path.join(cache, 'npm');
  const npmBytes = await directoryBytes(npmCache);
  const trash: string[] = [];
  const result = await exclusive(cache, async () => {
    const away = async (dir: string) => {
      const target = path.join(cache, `.trash-${randomUUID()}`);
      await fs.rename(dir, target);
      trash.push(target);
    };
    for (const name of await entries(cache))
      if (name.startsWith('.trash-')) trash.push(path.join(cache, name));
    const trees = path.join(cache, 'trees');
    const sealed: { dir: string; bytes: number; used: number }[] = [];
    for (const name of await entries(trees)) {
      const dir = path.join(trees, name);
      if (busy.has(dir) || leases.has(dir)) continue;
      const info = await readTreeInfo(dir, name);
      if (!info) await away(dir);
      else
        sealed.push({
          dir,
          bytes: info.bytes,
          used: (await fs.stat(path.join(dir, TREE_FILE))).mtimeMs,
        });
    }
    // Trees in use count toward the budget too, but are never removed.
    let total = sealed.reduce((sum, tree) => sum + tree.bytes, 0);
    let inUse = 0;
    for (const dir of leases.keys()) {
      const info = path.dirname(dir) === trees ? await readTreeInfo(dir, path.basename(dir)) : null;
      if (!info) continue;
      total += info.bytes;
      inUse += 1;
    }
    let removedTrees = 0;
    const now = Date.now();
    for (const tree of sealed.sort((a, b) => a.used - b.used)) {
      if (now - tree.used <= TREE_IDLE_MS && total <= MAX_TREES_BYTES) continue;
      await away(tree.dir);
      total -= tree.bytes;
      removedTrees += 1;
    }
    const removedNpmCache = npmBytes > MAX_NPM_CACHE_BYTES && !busy.has(npmCache);
    if (removedNpmCache) await away(npmCache);
    return { removedTrees, keptTrees: sealed.length - removedTrees + inUse, removedNpmCache };
  });
  for (const dir of trash) await fs.rm(dir, { recursive: true, force: true });
  return result;
}
