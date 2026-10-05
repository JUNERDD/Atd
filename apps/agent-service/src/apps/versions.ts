import { randomUUID } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { APP_MAX_VERSIONS, AppVersionSchema, parse, type AppVersion } from '@atd/agent-contracts';
import { AppFailure } from './errors.js';
import type { AppPaths } from './paths.js';

/**
 * Immutable version directories (`versions/<n>/`). A version is assembled in a temporary
 * sibling (`versions/.tmp-*`) and renamed into place, so a reader never sees a partial one; the
 * caller does that rename inside the store change that names the version.
 */

const VERSION_FILE = 'version.json';

async function versionNumbers(paths: AppPaths, appId: string): Promise<number[]> {
  let names: string[];
  try {
    names = await readdir(paths.versionsDir(appId));
  } catch {
    return [];
  }
  return names
    .filter((name) => /^[1-9][0-9]*$/.test(name))
    .map(Number)
    .sort((a, b) => b - a);
}

export async function readVersion(paths: AppPaths, appId: string, n: number): Promise<AppVersion> {
  try {
    const file = path.join(paths.version(appId, n), VERSION_FILE);
    return parse(AppVersionSchema, JSON.parse(await readFile(file, 'utf8')));
  } catch {
    throw new AppFailure(404, 'not_found', `Version ${n} of ${appId} is not kept.`);
  }
}

/** The kept versions, newest first; an unreadable one is skipped. */
export async function listVersions(paths: AppPaths, appId: string): Promise<AppVersion[]> {
  const versions: AppVersion[] = [];
  for (const n of await versionNumbers(paths, appId)) {
    const version = await readVersion(paths, appId, n).catch(() => null);
    if (version) versions.push(version);
  }
  return versions.slice(0, APP_MAX_VERSIONS);
}

/** A temporary directory beside the versions, on the same volume so the rename is atomic. */
export async function versionDraft(paths: AppPaths, appId: string): Promise<string> {
  const dir = path.join(paths.versionsDir(appId), `.tmp-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Moves an assembled draft into place as the next version and prunes the oldest beyond
 * `APP_MAX_VERSIONS` (never the new one). Call inside the store change that records the
 * version. Answers the version.
 */
export async function installVersion(
  paths: AppPaths,
  appId: string,
  draft: string,
  fields: Omit<AppVersion, 'n' | 'createdAt'>,
  current: number,
): Promise<AppVersion> {
  const existing = await versionNumbers(paths, appId);
  const n = Math.max(current, existing[0] ?? 0) + 1;
  const version = parse(AppVersionSchema, { n, createdAt: new Date().toISOString(), ...fields });
  await writeFile(path.join(draft, VERSION_FILE), `${JSON.stringify(version, null, 2)}\n`);
  await rename(draft, paths.version(appId, n));
  for (const old of existing.slice(APP_MAX_VERSIONS - 1))
    await rm(paths.version(appId, old), { recursive: true, force: true });
  return version;
}

/** A draft holding a copy of version `n`, for a revert. */
export async function copyVersionDraft(paths: AppPaths, appId: string, n: number) {
  const source = paths.version(appId, n);
  const old = await readVersion(paths, appId, n);
  const draft = await versionDraft(paths, appId);
  for (const entry of await readdir(source)) {
    if (entry === VERSION_FILE) continue;
    await cp(path.join(source, entry), path.join(draft, entry), { recursive: true });
  }
  return { draft, old };
}

/** Removes drafts a crash left behind. */
export async function removeDrafts(paths: AppPaths, appId: string): Promise<void> {
  let names: string[] = [];
  try {
    names = await readdir(paths.versionsDir(appId));
  } catch {
    return;
  }
  for (const name of names.filter((item) => item.startsWith('.tmp-')))
    await rm(path.join(paths.versionsDir(appId), name), { recursive: true, force: true });
}
