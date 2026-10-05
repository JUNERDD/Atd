import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadToolchain, realpath } from '../toolchain.js';
import { auditLock, auditTree } from './audit.js';
import { exclusive, leaseTree, markBusy, readTreeInfo, TREE_FILE, type TreeInfo } from './cache.js';
import { declaredErrors, dependencyPackageJson, type DeclaredDependencies } from './declared.js';
import { DependencyFailure, type DependencyError } from './errors.js';
import {
  INSTALL_TIMEOUT_MS,
  MIN_RELEASE_AGE_DAYS,
  NPM_REGISTRY,
  npmDirs,
  RESOLVE_TIMEOUT_MS,
  runNpm,
  type NpmCommand,
  type NpmDirs,
  type NpmResult,
} from './npm.js';

/**
 * Producing the tree of an app's declared packages in the dependency cache (cache.ts). A tree is
 * keyed by the sha256 of the install policy, npm's version, the platform, the generated
 * package.json and the lockfile, so apps and versions with the same packages share it. It is
 * installed by `npm ci` in a temporary directory, audited, then sealed: `tree.json` is written
 * last and the directory renamed into place, and a directory without `tree.json` is never used.
 */

/** Raised when the install flags or audits change, so older trees are not reused. */
const POLICY_VERSION = 1;

export interface DependencyTree {
  key: string;
  /** The sealed tree the builder and `tsc` read (the `deps` of `buildApp` and `typecheckApp`). */
  root: string;
  /** The declared names: what app code may import from the tree. */
  names: string[];
  /** The generated package.json and the lockfile, which the version records under `deps/`. */
  packageJson: string;
  lock: string;
  /** The version npm locked for each declared package. */
  resolved: Record<string, string>;
  packages: number;
  bytes: number;
  /** A tree sealed before, one installed offline from npm's cache, or one from the registry. */
  from: 'tree' | 'npm-cache' | 'registry';
  notes: string[];
}

export interface PrepareDependenciesOptions {
  /** The manifest's `dependencies`, already schema-checked; none when empty or absent. */
  declared: DeclaredDependencies | undefined;
  /** The `deps/` files of the app's current version, when it has them. */
  previous: { packageJson: string; lock: string } | null;
  /** The dependency cache (`apps/.cache/deps`); created when missing. */
  cacheDir: string;
  /** Scratch for resolving, npm's home and the profile; the caller removes it. */
  workDir: string;
  /** The Node binary npm runs with; defaults to the service's own. */
  nodePath?: string;
  /** The registry; the service always uses the default, the public npm registry. */
  registry?: string;
}

export type PrepareDependenciesResult =
  | {
      ok: true;
      /** Null when the app declares no packages: it builds exactly as one without the field. */
      tree: DependencyTree | null;
      durationMs: number;
      /** Ends the lease that keeps pruning off the tree; call once its builds are done. */
      release: () => void;
    }
  | { ok: false; errors: DependencyError[]; durationMs: number };

interface Job {
  cache: string;
  dirs: NpmDirs;
  scratch: string;
  registry: string;
  nodePath: string | undefined;
}

/** Runs npm for `job`, counting the run as busy so pruning keeps npm's cache meanwhile. */
async function npm(
  job: Job,
  command: Pick<NpmCommand, 'args' | 'cwd' | 'timeoutMs' | 'activity'>,
): Promise<NpmResult> {
  const release = markBusy(job.dirs.cache);
  try {
    return await runNpm({
      ...command,
      dirs: job.dirs,
      scratch: job.scratch,
      registry: job.registry,
      ...(job.nodePath ? { nodePath: job.nodePath } : {}),
    });
  } finally {
    release();
  }
}

/** Throws the error of a failed npm run. */
function check(result: NpmResult): void {
  if (!result.ok) throw new DependencyFailure([result.failure.error]);
}

/**
 * Resolves a lockfile for `packageJson`: seeded with the previous one, packages whose ranges did
 * not change keep their versions. Only releases at least `MIN_RELEASE_AGE_DAYS` old are picked,
 * except for the pinned peers, which follow the toolchain.
 */
async function resolveLock(job: Job, packageJson: string, seed: string | undefined) {
  const dir = path.join(job.scratch, 'resolve');
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir);
  await fs.writeFile(path.join(dir, 'package.json'), packageJson);
  if (seed !== undefined) await fs.writeFile(path.join(dir, 'package-lock.json'), seed);
  const peers = Object.keys(loadToolchain().peerPins);
  const args = [
    'install',
    '--package-lock-only',
    '--lockfile-version=3',
    `--min-release-age=${MIN_RELEASE_AGE_DAYS}`,
    ...peers.map((name) => `--min-release-age-exclude=${name}`),
  ];
  const cwd = realpath(dir);
  check(await npm(job, { args, cwd, timeoutMs: RESOLVE_TIMEOUT_MS, activity: 'Resolving' }));
  return fs.readFile(path.join(dir, 'package-lock.json'), 'utf8');
}

const isCode = (error: unknown, ...codes: string[]) =>
  error instanceof Error && 'code' in error && codes.includes(String(error.code));

interface Sealed {
  info: TreeInfo;
  from: DependencyTree['from'];
}

interface TreeFiles {
  packageJson: string;
  lock: string;
  /** The lockfile is the previous version's, unchanged. */
  reused: boolean;
}

/**
 * Installs, audits and seals tree `key`. A reused lockfile is first installed offline from npm's
 * cache and goes online only for what the cache lacks (ENOTCACHED); a new one goes online at once.
 */
async function seal(job: Job, key: string, files: TreeFiles, packages: number): Promise<Sealed> {
  const trees = path.join(job.cache, 'trees');
  await fs.mkdir(trees, { recursive: true });
  const tmp = path.join(trees, `.tmp-${randomUUID()}`);
  const release = markBusy(tmp);
  try {
    await fs.mkdir(tmp);
    await fs.writeFile(path.join(tmp, 'package.json'), files.packageJson);
    await fs.writeFile(path.join(tmp, 'package-lock.json'), files.lock);
    const ci = (mode: string) =>
      npm(job, {
        args: ['ci', '--no-bin-links', mode],
        cwd: tmp,
        timeoutMs: INSTALL_TIMEOUT_MS,
        activity: 'Installing',
      });
    let from: Sealed['from'] = 'npm-cache';
    const offline = files.reused ? await ci('--offline') : null;
    if (!offline?.ok) {
      if (offline && offline.failure.npmCode !== 'ENOTCACHED') check(offline);
      from = 'registry';
      check(await ci('--prefer-offline'));
    }
    const audit = await auditTree(tmp);
    const info: TreeInfo = {
      key,
      npm: loadToolchain().npm.version,
      policy: POLICY_VERSION,
      packages,
      ...audit,
      createdAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(tmp, TREE_FILE), `${JSON.stringify(info, null, 2)}\n`);
    const dir = path.join(trees, key);
    try {
      await fs.rename(tmp, dir);
    } catch (error) {
      // Another process sealed the same tree first: that one is used.
      const sealed = isCode(error, 'EEXIST', 'ENOTEMPTY') ? await readTreeInfo(dir, key) : null;
      if (!sealed) throw error;
      return { info: sealed, from };
    }
    return { info, from };
  } finally {
    release();
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** One install per tree in this process; concurrent builds of the same packages share it. */
const installs = new Map<string, Promise<Sealed>>();

/**
 * Tree `key`, sealed before or installed now, leased to the caller. The lease is taken before
 * the look-up, which is queued against pruning, so a tree found here is never pruned in use.
 */
async function obtainTree(job: Job, key: string, files: TreeFiles, packages: number) {
  const dir = path.join(job.cache, 'trees', key);
  const release = leaseTree(dir);
  try {
    const info = await exclusive(job.cache, () => readTreeInfo(dir, key));
    if (info) {
      const now = new Date();
      // Pruning ranks trees by their last use.
      await fs.utimes(path.join(dir, TREE_FILE), now, now);
      return { dir, sealed: { info, from: 'tree' as const }, release };
    }
    let pending = installs.get(dir);
    if (!pending) {
      pending = seal(job, key, files, packages).finally(() => installs.delete(dir));
      installs.set(dir, pending);
    }
    return { dir, sealed: await pending, release };
  } catch (error) {
    release();
    throw error;
  }
}

function treeKey(packageJson: string, lock: string): string {
  const platform = `${process.platform}-${process.arch}`;
  const parts = [POLICY_VERSION, loadToolchain().npm.version, platform, packageJson, lock];
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

/**
 * Step 2b of an app build, between staging and the typecheck and build: the tree of the packages
 * the manifest declares. Refused declarations fail at once. When the app's current version
 * recorded the same package.json, its lockfile is reused and nothing is resolved (offline
 * builds work); otherwise npm resolves one seeded with the previous lockfile. The lockfile is
 * audited before anything is downloaded, then the tree is reused or installed and sealed.
 * Failures carry `dependency_*` codes; nothing here throws for a refused or failed install.
 */
export async function prepareDependencies(
  options: PrepareDependenciesOptions,
): Promise<PrepareDependenciesResult> {
  const started = performance.now();
  const durationMs = () => Math.round(performance.now() - started);
  const declared = options.declared ?? {};
  if (Object.keys(declared).length === 0)
    return { ok: true, tree: null, durationMs: 0, release: () => undefined };
  const refused = declaredErrors(declared);
  if (refused.length > 0) return { ok: false, errors: refused, durationMs: durationMs() };
  try {
    const peerPins = loadToolchain().peerPins;
    await fs.mkdir(options.cacheDir, { recursive: true });
    const cache = realpath(options.cacheDir);
    await fs.mkdir(options.workDir, { recursive: true });
    const job: Job = {
      cache,
      dirs: await npmDirs(cache),
      scratch: realpath(options.workDir),
      registry: options.registry ?? NPM_REGISTRY,
      nodePath: options.nodePath,
    };
    const packageJson = dependencyPackageJson(declared, peerPins);
    const previous = options.previous;
    const reused = previous?.packageJson === packageJson;
    const lock = reused ? previous.lock : await resolveLock(job, packageJson, previous?.lock);
    const audit = auditLock(
      lock,
      { dependencies: declared, peerDependencies: peerPins },
      job.registry,
    );
    const key = treeKey(packageJson, lock);
    const files = { packageJson, lock, reused };
    const { dir, sealed, release } = await obtainTree(job, key, files, audit.packages);
    const tree: DependencyTree = {
      key,
      root: dir,
      names: Object.keys(declared).sort(),
      packageJson,
      lock,
      resolved: audit.resolved,
      packages: sealed.info.packages,
      bytes: sealed.info.bytes,
      from: sealed.from,
      notes: audit.notes,
    };
    return { ok: true, tree, durationMs: durationMs(), release };
  } catch (error) {
    if (error instanceof DependencyFailure)
      return { ok: false, errors: error.errors, durationMs: durationMs() };
    throw error;
  }
}
