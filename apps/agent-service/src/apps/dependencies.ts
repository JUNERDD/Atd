import { constants } from 'node:fs';
import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Value } from 'typebox/value';
import {
  prepareDependencies,
  type DependenciesUsed,
  type DependencyTree,
  type PrepareDependenciesResult,
} from '@atd/app-kit/node';
import {
  AppDependenciesSchema,
  type AppDependencies,
  type AppManifest,
} from '@atd/agent-contracts';
import type { AppPaths } from './paths.js';
import type { AppRecord } from './records.js';
import { currentBuild } from './versions.js';

/**
 * The npm packages an app declares (`atd-app.json` `dependencies`), around app-kit's
 * `prepareDependencies`. Each build records under `deps/` the generated package.json and the
 * lockfile its tree was installed from, so a later build with the same packages, a revert (which
 * copies the build) and Continue editing (whose builds start from the current version) reproduce
 * the same tree without resolving anything. Both files exist only under the protected apps root:
 * staging refuses them in the agent's source.
 */

const DEPS_DIR = 'deps';
const PACKAGE_JSON = 'package.json';
const LOCKFILE = 'package-lock.json';
/** A larger manifest is not read for the permission prompt; the build reports what is wrong. */
const PROMPT_MANIFEST_BYTES = 64 * 1024;

const isMissing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

/** The `deps/` files of the app's current build; null for a new app or one without packages. */
async function recordedDeps(paths: AppPaths, app: AppRecord | undefined) {
  if (!app) return null;
  const dir = path.join(await currentBuild(paths, app), DEPS_DIR);
  try {
    const packageJson = await readFile(path.join(dir, PACKAGE_JSON), 'utf8');
    return { packageJson, lock: await readFile(path.join(dir, LOCKFILE), 'utf8') };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

/**
 * The tree of the packages `manifest` declares, in the profile's dependency cache. The app's
 * current version is the previous build: its lockfile is reused when it recorded the same
 * package.json, and seeds the resolution otherwise.
 */
export async function prepareAppDependencies(
  paths: AppPaths,
  existing: AppRecord | undefined,
  manifest: AppManifest,
  workDir: string,
): Promise<PrepareDependenciesResult> {
  return prepareDependencies({
    declared: manifest.dependencies,
    previous: await recordedDeps(paths, existing),
    cacheDir: paths.depsCacheDir,
    workDir,
  });
}

/** Records the tree's package.json and lockfile in a version draft. */
export async function recordDeps(draft: string, tree: DependencyTree): Promise<void> {
  const dir = path.join(draft, DEPS_DIR);
  await mkdir(dir);
  await writeFile(path.join(dir, PACKAGE_JSON), tree.packageJson);
  await writeFile(path.join(dir, LOCKFILE), tree.lock);
}

/** What a build tells the agent about the app's packages. */
export interface DependencyReport {
  declared: AppDependencies;
  /** The exact version installed for each declared package. */
  resolved: Record<string, string>;
  /** Packages in the tree, their own dependencies included. */
  packages: number;
  /** The tree was reused, installed offline from npm's cache, or downloaded. */
  from: DependencyTree['from'];
  /** Declared packages neither the page nor the backend imports (`@types/*` aside). */
  unused: string[];
  notes: string[];
  durationMs: number;
}

export function dependencyReport(
  tree: DependencyTree,
  declared: AppDependencies,
  used: DependenciesUsed | undefined,
  durationMs: number,
): DependencyReport {
  const loaded = new Set([...(used?.web ?? []), ...(used?.server ?? [])]);
  return {
    declared,
    resolved: tree.resolved,
    packages: tree.packages,
    from: tree.from,
    unused: tree.names.filter((name) => !name.startsWith('@types/') && !loaded.has(name)),
    notes: tree.notes,
    durationMs,
  };
}

/** `value`'s `dependencies` when they are valid, `{}` when it declares none, else null. */
function declaredOf(value: unknown): AppDependencies | null {
  if (value === null || typeof value !== 'object') return null;
  const declared: unknown = Reflect.get(value, 'dependencies') ?? {};
  return Value.Check(AppDependenciesSchema, declared) ? declared : null;
}

/** The packages an agent-written manifest declares; null when it cannot be read as a manifest. */
async function manifestDeclared(file: string): Promise<AppDependencies | null> {
  try {
    // Not followed: staging refuses links, and the prompt must not show what one points to.
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > PROMPT_MANIFEST_BYTES) return null;
      return declaredOf(JSON.parse(await handle.readFile('utf8')));
    } finally {
      await handle.close();
    }
  } catch {
    // Missing, a link or not JSON: the build itself reports what is wrong.
    return null;
  }
}

/**
 * How a build of the source whose manifest is `manifestFile` would change the app's packages, for
 * the build's permission prompt, so a user who confirms builds sees new third-party code before
 * it is installed: `adds date-fns ^4.1.0, changes x ^1.0.0 → ^2.0.0, removes y`. Empty when
 * nothing changes or the manifest cannot be read.
 */
export async function dependencyChange(
  paths: AppPaths,
  existing: AppRecord | undefined,
  manifestFile: string,
): Promise<string> {
  const next = await manifestDeclared(manifestFile);
  if (!next) return '';
  const recorded = await recordedDeps(paths, existing);
  const before = (recorded && declaredOf(JSON.parse(recorded.packageJson))) ?? {};
  const changes: string[] = [];
  for (const name of Object.keys(next).sort()) {
    const range = next[name];
    const old = before[name];
    if (old === undefined) changes.push(`adds ${name} ${range}`);
    else if (old !== range) changes.push(`changes ${name} ${old} → ${range}`);
  }
  for (const name of Object.keys(before).sort())
    if (next[name] === undefined) changes.push(`removes ${name}`);
  return changes.join(', ');
}
