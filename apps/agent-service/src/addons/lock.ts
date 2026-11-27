import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AddonLockSchema,
  errorMessage,
  parse,
  type AddonArch,
  type AddonArtifact,
} from '@atd/agent-contracts';
import { scrubPersonalPaths } from '../diagnostics/scrub-paths.js';
import type { Logger } from '../logging.js';

/** The lock a build ships beside the service package (`addons.lock.json`, `AddonLock`). */
const LOCK_FILE = 'addons.lock.json';

/** The service package root: `src/addons` in the repo and `dist/addons` in a pack are two below it. */
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The add-on archives this build accepts for this Mac, by id, and every id the lock names. */
export interface AddonCatalog {
  /** The lock's file, for logs; null when no lock was found. */
  source: string | null;
  /** Ids the lock names for any architecture. */
  ids: string[];
  /** The archive per id for this Mac's architecture. */
  artifacts: ReadonlyMap<string, AddonArtifact>;
}

export type AddonLockStatus = 'ok' | 'missing' | 'invalid';

export interface AddonLockDiagnostics {
  status: AddonLockStatus;
  source: string | null;
  artifactCount: number;
  errorCode: string | null;
  errorMessage: string | null;
}

let lastAddonLockDiagnostics: AddonLockDiagnostics = {
  status: 'missing',
  source: null,
  artifactCount: 0,
  errorCode: null,
  errorMessage: null,
};

/** Returns a readonly snapshot of the most recent `addons.lock.json` load result. */
export function getAddonLockDiagnostics(): AddonLockDiagnostics {
  return { ...lastAddonLockDiagnostics };
}

/** Resets cached add-on lock diagnostics; intended for unit tests. */
export function resetAddonLockDiagnosticsForTests(): void {
  lastAddonLockDiagnostics = {
    status: 'missing',
    source: null,
    artifactCount: 0,
    errorCode: null,
    errorMessage: null,
  };
}

function classifyAddonLockError(error: unknown): string {
  if (error instanceof SyntaxError) return 'addons_lock_invalid_json';
  const msg = errorMessage(error);
  if (msg.includes('lists') && msg.includes('twice')) return 'addons_lock_duplicate_entry';
  if (msg.includes('non-https URL')) return 'addons_lock_insecure_url';
  if (error instanceof TypeError) return 'addons_lock_invalid_schema';
  return 'addons_lock_unreadable';
}

/** This Mac's architecture as add-on archives name it; null on any other. */
export function hostArch(arch: string = process.arch): AddonArch | null {
  if (arch === 'arm64') return 'arm64';
  if (arch === 'x64') return 'x64';
  return null;
}

import { DEV_LOCK_FILE, DevLockWatcher, devLockWatchPath } from './dev-lock-watcher.js';
export { DevLockWatcher, devLockWatchPath };

/**
 * Where this build's lock is: `AI_ADDONS_LOCK` (an absolute path) wins, then the one the pack put
 * in the service package root, then, for a development service only, the one
 * `pnpm --filter @atd/macos addons:pack` writes to `<repo>/tmp/addons`. Null when none exists.
 */
async function lockPath(development: boolean): Promise<string | null> {
  const override = process.env.AI_ADDONS_LOCK?.trim();
  if (override) {
    if (!path.isAbsolute(override)) throw new Error('AI_ADDONS_LOCK must be an absolute path.');
    return override;
  }
  const candidates = [path.join(PACKAGE_ROOT, LOCK_FILE)];
  if (development) candidates.push(DEV_LOCK_FILE);
  for (const candidate of candidates) if (await readable(candidate)) return candidate;
  return null;
}

async function readable(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads and validates the lock. A lock that does not parse, names an id and architecture twice,
 * or (outside development) offers a `file:` URL is refused whole: a build with a broken lock
 * offers no add-on rather than a guess. Without a lock every add-on is unavailable.
 */
export async function loadAddonCatalog(options: {
  development: boolean;
  log: Logger;
}): Promise<AddonCatalog> {
  const empty: AddonCatalog = { source: null, ids: [], artifacts: new Map() };
  let file: string | null = null;
  try {
    file = await lockPath(options.development);
    if (!file) {
      lastAddonLockDiagnostics = {
        status: 'missing',
        source: null,
        artifactCount: 0,
        errorCode: 'addons_lock_missing',
        errorMessage: null,
      };
      return empty;
    }
    const lock = parse(AddonLockSchema, JSON.parse(await readFile(file, 'utf8')));
    const seen = new Set<string>();
    for (const artifact of lock.addons) {
      const key = `${artifact.id}/${artifact.arch}`;
      if (seen.has(key)) throw new Error(`The lock lists ${key} twice.`);
      seen.add(key);
      if (!options.development && artifact.urls.some((url) => !url.startsWith('https:')))
        throw new Error(`The lock offers ${artifact.id} from a non-https URL.`);
    }
    const arch = hostArch();
    const artifacts = new Map(
      lock.addons
        .filter((artifact) => artifact.arch === arch)
        .map((artifact) => [artifact.id, artifact]),
    );
    lastAddonLockDiagnostics = {
      status: 'ok',
      source: scrubPersonalPaths(file),
      artifactCount: artifacts.size,
      errorCode: null,
      errorMessage: null,
    };
    return {
      source: file,
      ids: [...new Set(lock.addons.map((artifact) => artifact.id))],
      artifacts,
    };
  } catch (error) {
    lastAddonLockDiagnostics = {
      status: 'invalid',
      source: file ? scrubPersonalPaths(file) : null,
      artifactCount: 0,
      errorCode: classifyAddonLockError(error),
      errorMessage: scrubPersonalPaths(errorMessage(error)),
    };
    options.log.error('The add-on lock is unusable; no add-on is offered.', {
      lock: file,
      error: errorMessage(error),
    });
    return empty;
  }
}

function sameArtifact(a: AddonArtifact | undefined, b: AddonArtifact | undefined): boolean {
  if (!a || !b) return a === b;
  return (
    a.sha256 === b.sha256 &&
    a.version === b.version &&
    a.size === b.size &&
    a.urls.length === b.urls.length &&
    a.urls.every((url, index) => url === b.urls[index])
  );
}

/** Whether two loaded catalogs describe the exact same lock source, ids, and pinned artifacts. */
export function sameAddonCatalog(a: AddonCatalog, b: AddonCatalog): boolean {
  if (a.source !== b.source) return false;
  if (a.ids.length !== b.ids.length || a.artifacts.size !== b.artifacts.size) return false;
  for (let i = 0; i < a.ids.length; i += 1) if (a.ids[i] !== b.ids[i]) return false;
  for (const [id, first] of a.artifacts)
    if (!sameArtifact(first, b.artifacts.get(id))) return false;
  return true;
}

/** Whether two artifacts in a catalog differ (used to clear stale errors on lock reload). */
export function artifactChanged(
  a: AddonArtifact | undefined,
  b: AddonArtifact | undefined,
): boolean {
  return !sameArtifact(a, b);
}
