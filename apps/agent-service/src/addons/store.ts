import { lstat, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Type, type Static } from 'typebox';
import {
  AddonIdSchema,
  AddonManifestSchema,
  errorMessage,
  parse,
  type AddonManifest,
} from '@atd/agent-contracts';
import { atomicWrite } from '../config.js';
import type { Logger } from '../logging.js';

/**
 * The service-owned add-on layout under `<dataDir>/addons`: one directory per id holding one
 * directory per unpacked archive (`<id>/<sha256[0..16]>/`, its root `addon.json` included),
 * `state.json` naming the active archive of each id, and `.staging/` for work in progress, which
 * nothing reads and every start removes.
 */

/** The manifest at an archive's root, kept in its install directory. */
export const MANIFEST_FILE = 'addon.json';
const STATE_FILE = 'state.json';
const STAGING = '.staging';

const Sha256 = Type.String({ pattern: '^[0-9a-f]{64}$' });
const AddonStateSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    active: Type.Record(
      AddonIdSchema,
      Type.Object({ sha256: Sha256, version: Type.String({ maxLength: 64 }) }),
    ),
  },
  { additionalProperties: false },
);
/** `state.json`: the active archive of each installed add-on. */
export type AddonState = Static<typeof AddonStateSchema>;
export type AddonRecord = AddonState['active'][string];

/** An active install as consumers resolve it. */
export interface InstalledAddon extends AddonRecord {
  /** The install directory (absolute). */
  root: string;
  /** Entry points by name, absolute paths inside `root`. */
  entries: Record<string, string>;
}

/**
 * Add-ons an earlier build installed that this one retired; an install of one is never kept.
 * `computer-desktop` carried the Cua driver for native apps, whose engine is now built into the app
 * (docs/plans/2026-10-19-imperceptible-computer-use.md §10.1).
 */
export const RETIRED_ADDONS: ReadonlySet<string> = new Set(['computer-desktop']);

export function addonsRoot(dataDir: string): string {
  return path.join(dataDir, 'addons');
}

export function stagingRoot(dataDir: string): string {
  return path.join(addonsRoot(dataDir), STAGING);
}

/** Where one archive of an add-on is unpacked. */
export function installDir(dataDir: string, id: string, sha256: string): string {
  return path.join(addonsRoot(dataDir), id, sha256.slice(0, 16));
}

/** Reads `state.json`; a missing file is an empty state, an unreadable one is logged and ignored. */
export async function loadAddonState(dataDir: string, log: Logger): Promise<AddonState> {
  const file = path.join(addonsRoot(dataDir), STATE_FILE);
  try {
    return parse(AddonStateSchema, JSON.parse(await readFile(file, 'utf8')));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      log.warn('The add-on state is unreadable; every add-on counts as not installed.', {
        error: errorMessage(error),
      });
    return { schemaVersion: 1, active: {} };
  }
}

/** Replaces `state.json` atomically: a crash leaves the old state or the new one. */
export async function saveAddonState(dataDir: string, state: AddonState): Promise<void> {
  await atomicWrite(path.join(addonsRoot(dataDir), STATE_FILE), state, 0o644);
}

/**
 * Resolves an active record against its install directory: its `addon.json` must parse and name
 * the record's id and version, and every entry must be a regular file there. Null otherwise (a
 * directory someone deleted or changed); the install's files were verified when it activated.
 */
export async function resolveInstalled(
  dataDir: string,
  id: string,
  record: AddonRecord,
): Promise<InstalledAddon | null> {
  const root = installDir(dataDir, id, record.sha256);
  let manifest: AddonManifest;
  try {
    manifest = parse(
      AddonManifestSchema,
      JSON.parse(await readFile(path.join(root, MANIFEST_FILE), 'utf8')),
    );
  } catch {
    return null;
  }
  if (manifest.id !== id || manifest.version !== record.version) return null;
  const entries: Record<string, string> = {};
  for (const [name, relative] of Object.entries(manifest.entries)) {
    const file = path.join(root, relative);
    const stats = await lstat(file).catch(() => null);
    if (!stats?.isFile()) return null;
    entries[name] = file;
  }
  return { ...record, root, entries };
}

/**
 * Deletes an add-on's install directories other than `keep` (the active archive's, if any): what
 * a replaced version, a removal or an install interrupted before it activated left behind.
 */
export async function collectGarbage(
  dataDir: string,
  id: string,
  keep: string | undefined,
): Promise<void> {
  const dir = path.join(addonsRoot(dataDir), id);
  const names = await readdir(dir).catch(() => []);
  const kept = keep && path.basename(installDir(dataDir, id, keep));
  await Promise.all(
    names
      .filter((name) => name !== kept)
      .map((name) => rm(path.join(dir, name), { recursive: true, force: true })),
  );
}

/** Deletes everything an add-on's installs left under `<dataDir>/addons/<id>`, the directory too. */
export async function removeAddonDir(dataDir: string, id: string): Promise<void> {
  await rm(path.join(addonsRoot(dataDir), id), { recursive: true, force: true });
}

/** Removes the staging directory, where nothing outlives the job that made it. */
export async function clearStaging(dataDir: string): Promise<void> {
  await rm(stagingRoot(dataDir), { recursive: true, force: true });
}
