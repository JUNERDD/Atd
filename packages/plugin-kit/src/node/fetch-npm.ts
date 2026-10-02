import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extract, type ReadEntry } from 'tar';
import type { FetchLimits } from './installer.js';
import { droppedLinkWarning } from './fetch-local.js';
import { createBudget } from './limits.js';
import { packumentUrl, parseNpmSpec, verifyIntegrity } from './npm-spec.js';
import type { FetchedSource } from './fetch.js';

interface VersionDist {
  tarball: string;
  integrity?: string;
  shasum?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Picks the version a spec selects from a packument and validates its `dist`. */
function selectVersion(
  packument: unknown,
  name: string,
  selector: ReturnType<typeof parseNpmSpec>['selector'],
): { version: string; dist: VersionDist } {
  if (!isRecord(packument) || !isRecord(packument.versions)) {
    throw new Error(`The npm registry returned an unreadable package document for "${name}".`);
  }
  const tags = isRecord(packument['dist-tags']) ? packument['dist-tags'] : {};
  const version = selector.type === 'version' ? selector.value : tags[selector.value];
  if (typeof version !== 'string') {
    throw new Error(`"${name}" has no dist-tag "${selector.value}".`);
  }
  const manifest = packument.versions[version];
  const dist = isRecord(manifest) ? manifest.dist : undefined;
  if (!isRecord(dist) || typeof dist.tarball !== 'string') {
    throw new Error(`"${name}@${version}" does not exist on the npm registry.`);
  }
  return {
    version,
    dist: {
      tarball: dist.tarball,
      ...(typeof dist.integrity === 'string' ? { integrity: dist.integrity } : {}),
      ...(typeof dist.shasum === 'string' ? { shasum: dist.shasum } : {}),
    },
  };
}

/** Downloads a response body, refusing to buffer more than `maxBytes`. */
async function readCapped(response: Response, maxBytes: number): Promise<Buffer> {
  if (response.body === null) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(`The npm tarball is larger than ${maxBytes} bytes.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** The entry path after tar strips the leading `package/` directory ('' when fully stripped). */
function stripFirst(entryPath: string): string {
  return entryPath.replace(/^\.\//, '').split('/').slice(1).join('/');
}

function escapes(target: string): boolean {
  return path.posix.isAbsolute(target) || target === '..' || target.startsWith('../');
}

/**
 * Extracts a tarball into `tree`, stripping the leading directory, and returns the paths of
 * dropped links. Files, directories and links that stay inside the root are extracted; links
 * pointing outside are dropped; any other entry type rejects the whole package.
 */
async function extractTarball(file: string, tree: string, limits: FetchLimits): Promise<string[]> {
  const budget = createBudget(limits);
  const dropped: string[] = [];
  let failure: Error | undefined;
  await mkdir(tree, { recursive: true });
  await extract({
    file,
    cwd: tree,
    strip: 1,
    strict: true,
    preserveOwner: false,
    filter(entryPath, entry) {
      if (failure !== undefined) return false;
      const readEntry = entry as ReadEntry;
      const stripped = stripFirst(entryPath);
      try {
        // An if-chain rather than a switch: tar has many entry types and every unlisted one is refused.
        const { type } = readEntry;
        if (type === 'Directory') return true;
        if (type === 'File' || type === 'OldFile' || type === 'ContiguousFile') {
          budget.add(readEntry.size);
          return true;
        }
        if (type === 'SymbolicLink') {
          const link = readEntry.linkpath ?? '';
          const target = path.posix.normalize(path.posix.join(path.posix.dirname(stripped), link));
          if (path.posix.isAbsolute(link) || escapes(target)) {
            dropped.push(stripped);
            return false;
          }
          budget.add(0);
          return true;
        }
        if (type === 'Link') {
          if (escapes(path.posix.normalize(stripFirst(readEntry.linkpath ?? '')))) {
            dropped.push(stripped);
            return false;
          }
          budget.add(0);
          return true;
        }
        throw new Error(`The npm tarball contains an unsupported ${type} entry.`);
      } catch (error) {
        failure = error as Error;
        return false;
      }
    },
  });
  if (failure !== undefined) throw failure;
  return dropped.sort();
}

/**
 * Resolves an npm spec against the registry, verifies the tarball's integrity and extracts it.
 * Package lifecycle scripts are never run: the tarball is only unpacked.
 */
export async function fetchNpm(
  spec: string,
  paths: { tree: string; workDir: string },
  options: { registry: string; fetch: typeof globalThis.fetch; limits: FetchLimits },
): Promise<FetchedSource> {
  const { name, selector } = parseNpmSpec(spec);
  const packumentResponse = await options.fetch(packumentUrl(options.registry, name), {
    headers: { accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8' },
  });
  if (packumentResponse.status === 404) {
    throw new Error(`"${name}" was not found on the npm registry.`);
  }
  if (!packumentResponse.ok) {
    throw new Error(`The npm registry answered ${packumentResponse.status} for "${name}".`);
  }
  const { version, dist } = selectVersion(await packumentResponse.json(), name, selector);
  const tarballResponse = await options.fetch(dist.tarball);
  if (!tarballResponse.ok) {
    throw new Error(`Downloading "${name}@${version}" failed with ${tarballResponse.status}.`);
  }
  const tarball = await readCapped(tarballResponse, options.limits.maxBytes);
  const check = verifyIntegrity(tarball, dist);
  const file = path.join(paths.workDir, 'package.tgz');
  let dropped: string[];
  await writeFile(file, tarball);
  try {
    dropped = await extractTarball(file, paths.tree, options.limits);
  } finally {
    await rm(file, { force: true });
  }
  return {
    source: { kind: 'npm', spec: spec.trim() },
    resolved: { version, integrity: check.integrity },
    fallbackName: name,
    warnings: [
      ...(check.warning === undefined ? [] : [check.warning]),
      ...dropped.map(droppedLinkWarning),
    ],
  };
}
