import { randomUUID } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { Type } from 'typebox';
import { Value } from 'typebox/value';
import { APP_MAX_VERSIONS, AppVersionSchema, parse, type AppVersion } from '@atd/agent-contracts';
import { AppFailure } from './errors.js';
import { REVISION_PREFIX, type AppPaths } from './paths.js';
import type { AppRecord } from './records.js';

/**
 * Version directories (paths.ts). Each build's files live in a directory of their own,
 * `versions/.rev-<k>/`, named by its build revision and never changed once in place; version n is
 * a link, `versions/<n>`, to the build that last wrote it. A build is assembled in a draft
 * (`versions/.tmp-*`), renamed to its revision's directory, and published by creating or
 * replacing the version's link with one rename, inside the store change that records the
 * revision; that record is the commit point. Readers of the current build (the window's web root,
 * the backend, widgets, the icon) take its directory from the record (`currentBuild`) and keep
 * reading that build once resolved; the version history goes through the links, each of which
 * names one whole build. The build an in-place publish replaced stays until the app's next
 * publish or the next service start, so what still reads it can reload first. Versions published
 * before build revisions are plain directories: read the same way, never rebuilt in place.
 */

const VERSION_FILE = 'version.json';
/** Drafts and temporary links; whatever carries it after a publish is a leftover. */
const DRAFT_PREFIX = '.tmp-';

/** `version.json` as it was written before build revisions. */
const PreRevisionVersionSchema = Type.Object(
  {
    n: AppVersionSchema.properties.n,
    createdAt: AppVersionSchema.properties.createdAt,
    runId: AppVersionSchema.properties.runId,
    summary: AppVersionSchema.properties.summary,
    typecheck: AppVersionSchema.properties.typecheck,
  },
  { additionalProperties: false },
);

/** What a build writes into its version besides the numbering: its run, note and type check. */
export type VersionBuild = Pick<AppVersion, 'runId' | 'summary' | 'typecheck'>;

async function entries(paths: AppPaths, appId: string): Promise<string[]> {
  return readdir(paths.versionsDir(appId)).catch(() => []);
}

/** The version numbers among `versions/` entries, newest first. */
function versionNumbers(names: string[]): number[] {
  return names
    .filter((name) => /^[1-9][0-9]*$/.test(name))
    .map(Number)
    .sort((a, b) => b - a);
}

/** The build revision a `versions/` entry (or link target) names; null for anything else. */
function revisionOf(name: string): number | null {
  const digits = name.startsWith(REVISION_PREFIX) ? name.slice(REVISION_PREFIX.length) : '';
  return /^[1-9][0-9]*$/.test(digits) ? Number(digits) : null;
}

/** The build each version links to, by version; versions from before revisions have none. */
async function links(paths: AppPaths, appId: string, names: string[]) {
  const linked = new Map<number, number>();
  for (const n of versionNumbers(names)) {
    const target = await readlink(paths.version(appId, n)).catch(() => null);
    const revision = target === null ? null : revisionOf(target);
    if (revision !== null) linked.set(n, revision);
  }
  return linked;
}

/** Points version n at build `revision`: creates its link, or replaces it in one rename. */
async function link(paths: AppPaths, appId: string, n: number, revision: number) {
  const temporary = path.join(paths.versionsDir(appId), `${DRAFT_PREFIX}${randomUUID()}`);
  await symlink(path.basename(paths.revision(appId, revision)), temporary);
  await rename(temporary, paths.version(appId, n));
}

/**
 * Removes the builds no version links to, except `kept`: the build the record names, which an
 * in-place publish has just unlinked while the record still names it, and which an open window
 * or a running backend may read until it reloads.
 */
async function sweep(paths: AppPaths, appId: string, kept: number): Promise<void> {
  const names = await entries(paths, appId);
  const linked = new Set((await links(paths, appId, names)).values());
  for (const name of names) {
    const revision = revisionOf(name);
    if (revision !== null && revision !== kept && !linked.has(revision))
      await rm(path.join(paths.versionsDir(appId), name), { recursive: true, force: true });
  }
}

/**
 * The directory of the app's current build, as its record names it: the record's revision, or,
 * when the current version was published before build revisions, its plain directory. Readers of
 * the current build come here rather than through `versions/<n>`: the record is the commit point,
 * so they never see a build it does not name, and a lookup that resolves a link while a publish
 * replaces it can fail (EINVAL on APFS), while a build directory's name is never replaced.
 */
export async function currentBuild(
  paths: AppPaths,
  app: Pick<AppRecord, 'id' | 'currentVersion' | 'revision'>,
): Promise<string> {
  const version = paths.version(app.id, app.currentVersion);
  // lstat reads the entry itself, so it cannot meet a link being replaced.
  return (await lstat(version)).isSymbolicLink() ? paths.revision(app.id, app.revision) : version;
}

/**
 * Version n's `version.json`. One written before build revisions had a single build: revision n
 * (the number the record's upgrade gives its current version), built when it was created.
 */
export async function readVersion(paths: AppPaths, appId: string, n: number): Promise<AppVersion> {
  try {
    const file = path.join(paths.version(appId, n), VERSION_FILE);
    const value: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (!Value.Check(PreRevisionVersionSchema, value)) return parse(AppVersionSchema, value);
    return { ...value, revision: value.n, updatedAt: value.createdAt };
  } catch {
    throw new AppFailure(404, 'not_found', `Version ${n} of ${appId} is not kept.`);
  }
}

/** The kept versions, newest first; an unreadable one is skipped. */
export async function listVersions(paths: AppPaths, appId: string): Promise<AppVersion[]> {
  const versions: AppVersion[] = [];
  for (const n of versionNumbers(await entries(paths, appId))) {
    const version = await readVersion(paths, appId, n).catch(() => null);
    if (version) versions.push(version);
  }
  return versions.slice(0, APP_MAX_VERSIONS);
}

/** A temporary directory beside the versions, on the same volume so the rename is atomic. */
export async function versionDraft(paths: AppPaths, appId: string): Promise<string> {
  const dir = path.join(paths.versionsDir(appId), `${DRAFT_PREFIX}${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * The version a build of run `runId` rewrites in place: the current version, when that run
 * published it. Null for a build outside any run, and when the current version came from another
 * run, from a revert, or from before build revisions (a plain directory no rename replaces whole).
 */
export async function runVersion(
  paths: AppPaths,
  appId: string,
  current: number,
  runId: string | undefined,
): Promise<AppVersion | null> {
  if (!runId) return null;
  const entry = await lstat(paths.version(appId, current)).catch(() => null);
  if (!entry?.isSymbolicLink()) return null;
  const version = await readVersion(paths, appId, current).catch(() => null);
  return version?.runId === runId ? version : null;
}

/**
 * Publishes an assembled draft as the app's next build revision: as version `replace.n` in place
 * (its number, creation time and run kept, `build` taking over the rest), or without `replace`
 * as the next version after `current.version`, pruning the oldest beyond `APP_MAX_VERSIONS`
 * (never the new one). Then removes the builds no version links to, except the record's current
 * one, which stays until the next publish. Call inside the store change that records the
 * revision. Answers the version.
 */
export async function installVersion(
  paths: AppPaths,
  appId: string,
  draft: string,
  build: VersionBuild,
  options: { current: { version: number; revision: number }; replace: AppVersion | null },
): Promise<AppVersion> {
  const { current, replace } = options;
  const names = await entries(paths, appId);
  const numbers = versionNumbers(names);
  // Past any build a failed publish left behind, so no build directory is ever reused.
  const revision = Math.max(current.revision, ...names.map((name) => revisionOf(name) ?? 0)) + 1;
  const now = new Date().toISOString();
  const version = parse(
    AppVersionSchema,
    replace
      ? { ...replace, ...build, revision, updatedAt: now }
      : {
          n: Math.max(current.version, numbers[0] ?? 0) + 1,
          createdAt: now,
          updatedAt: now,
          revision,
          ...build,
        },
  );
  await writeFile(path.join(draft, VERSION_FILE), `${JSON.stringify(version, null, 2)}\n`);
  await rename(draft, paths.revision(appId, revision));
  await link(paths, appId, version.n, revision);
  if (!replace)
    for (const old of numbers.slice(APP_MAX_VERSIONS - 1))
      await rm(paths.version(appId, old), { recursive: true, force: true });
  await sweep(paths, appId, current.revision);
  return version;
}

/** A draft holding a copy of version `n`'s build, for a revert. */
export async function copyVersionDraft(paths: AppPaths, appId: string, n: number) {
  const old = await readVersion(paths, appId, n);
  // Resolved once, so the copy is of one build even if the version is rebuilt meanwhile.
  const source = await realpath(paths.version(appId, n));
  const draft = await versionDraft(paths, appId);
  for (const entry of await readdir(source)) {
    if (entry === VERSION_FILE) continue;
    await cp(path.join(source, entry), path.join(draft, entry), { recursive: true });
  }
  return { draft, old };
}

/**
 * Puts an app's versions back in line with its record after a crash or a failed publish. Removes
 * drafts and temporary links; points the current version back at the record's build when a
 * publish replaced the link but its record never landed (that build is still kept then); drops
 * the links of versions published after the record's build; removes the builds nothing links to.
 */
export async function recoverVersions(
  paths: AppPaths,
  app: Pick<AppRecord, 'id' | 'currentVersion' | 'revision'>,
): Promise<void> {
  const names = await entries(paths, app.id);
  for (const name of names.filter((item) => item.startsWith(DRAFT_PREFIX)))
    await rm(path.join(paths.versionsDir(app.id), name), { recursive: true, force: true });
  const recorded = path.basename(paths.revision(app.id, app.revision));
  for (const [n, revision] of await links(paths, app.id, names)) {
    if (revision <= app.revision) continue;
    if (n !== app.currentVersion) await rm(paths.version(app.id, n), { force: true });
    else if (names.includes(recorded)) await link(paths, app.id, n, app.revision);
  }
  await sweep(paths, app.id, app.revision);
}
