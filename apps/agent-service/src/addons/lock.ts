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

/** This Mac's architecture as add-on archives name it; null on any other. */
export function hostArch(arch: string = process.arch): AddonArch | null {
  if (arch === 'arm64') return 'arm64';
  if (arch === 'x64') return 'x64';
  return null;
}

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
  if (development) candidates.push(path.join(PACKAGE_ROOT, '..', '..', 'tmp', 'addons', LOCK_FILE));
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
    if (!file) return empty;
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
    return {
      source: file,
      ids: [...new Set(lock.addons.map((artifact) => artifact.id))],
      artifacts: new Map(
        lock.addons
          .filter((artifact) => artifact.arch === arch)
          .map((artifact) => [artifact.id, artifact]),
      ),
    };
  } catch (error) {
    options.log.error('The add-on lock is unusable; no add-on is offered.', {
      lock: file,
      error: errorMessage(error),
    });
    return empty;
  }
}
