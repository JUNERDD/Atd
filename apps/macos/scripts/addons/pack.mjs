#!/usr/bin/env node
/**
 * Packs the add-ons for this Mac's native architecture and writes the lock that pins them
 * (packages/agent-contracts/src/addons.ts: AddonLock, AddonManifest):
 *
 *   node scripts/addons/pack.mjs
 *   node scripts/addons/pack.mjs --release --out <dir> [--marketing-version <version>]
 *
 * Development (the default, `pnpm --filter @atd/macos addons:pack`) writes the archives and
 * `addons.lock.json` with `file:` URLs to tmp/addons, where a `--development` service finds the
 * lock, and stages the pinned Node the Debug app runs the browser worker with (tmp/t7-node), then
 * checks the result with verify-app's add-on checks. Release writes them to `--out` with the
 * mirror's content-addressed URL and the GitHub release asset of `v<marketing version>` (default
 * apps/macos/package.json's version); prepare-service-pack.mjs runs it for every Release build and
 * embeds the lock in the service pack, so the app's signature covers it.
 *
 * Each archive is deterministic (addons/archive.mjs), so unchanged inputs give the same SHA-256.
 * Needs the service build (`pnpm build`) for the browser worker.
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { nativeHostArch } from '../arch.mjs';
import { EXECUTABLE_MODE, FILE_MODE, writeArchive } from './archive.mjs';
import { browserPayload } from './browser.mjs';
import { ARCHIVE_PATTERN, LOCK_FILE, MANIFEST_FILE, archiveName, releaseUrls } from './layout.mjs';
import { checkLock, checkManifest } from './schema.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
/** Where the development lock lives; the service's `--development` lookup reads it there. */
export const DEV_ADDONS_DIR = path.join(repoRoot, 'tmp', 'addons');
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/** The manifest and archive bytes of one payload; `addon.json` first, then files by path. */
function archive(payload, arch) {
  const files = [...payload.files].sort(byPath);
  const manifest = {
    schemaVersion: 1,
    id: payload.id,
    version: payload.version,
    arch,
    entries: payload.entries,
    executables: files.filter((file) => file.executable).map((file) => file.path),
    files: files.map((file) => ({
      path: file.path,
      sha256: sha256(file.data),
      size: file.data.length,
    })),
  };
  checkManifest(manifest, `${payload.id} ${MANIFEST_FILE}`);
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const entries = [
    { path: MANIFEST_FILE, data: manifestBytes, mode: FILE_MODE },
    ...files.map((file) => ({
      path: file.path,
      data: file.data,
      mode: file.executable ? EXECUTABLE_MODE : FILE_MODE,
    })),
  ];
  const unpackedSize = entries.reduce((total, entry) => total + entry.data.length, 0);
  return { manifest, bytes: writeArchive(entries), unpackedSize };
}

/**
 * Packs every add-on for `arch` into `outDir`, replacing an earlier run's archives and lock there,
 * and returns the lock file's path and the lock. `urls(artifact, file)` lists an archive's URLs.
 */
export async function packAddons({ arch, outDir, urls }) {
  await mkdir(outDir, { recursive: true });
  for (const name of await readdir(outDir))
    if (ARCHIVE_PATTERN.test(name) || name === LOCK_FILE) await rm(path.join(outDir, name));
  const addons = [];
  for (const payload of [await browserPayload({ repoRoot })]) {
    const { bytes, unpackedSize } = archive(payload, arch);
    const artifact = { id: payload.id, version: payload.version, arch, sha256: sha256(bytes) };
    const file = path.join(outDir, archiveName(artifact));
    await writeFile(file, bytes);
    addons.push({ ...artifact, size: bytes.length, unpackedSize, urls: urls(artifact, file) });
    process.stdout.write(
      `Packed ${path.basename(file)}: ${bytes.length} bytes (${unpackedSize} unpacked), sha256 ${artifact.sha256}\n`,
    );
  }
  const lock = { schemaVersion: 1, addons: addons.sort((a, b) => (a.id < b.id ? -1 : 1)) };
  checkLock(lock);
  const lockFile = path.join(outDir, LOCK_FILE);
  await writeFile(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
  process.stdout.write(`Wrote ${lockFile}\n`);
  return { lockFile, lock };
}

/** Release URLs for `appVersion`, which names the GitHub release that carries the archives. */
export function releaseUrlsFor(appVersion) {
  if (!VERSION.test(appVersion)) throw new Error(`${appVersion} is not a release version.`);
  return (artifact) => releaseUrls(artifact, appVersion);
}

/** The app version the release lock names unless one is given: apps/macos/package.json's. */
export async function packageVersion() {
  const manifest = path.join(repoRoot, 'apps', 'macos', 'package.json');
  return JSON.parse(await readFile(manifest, 'utf8')).version;
}

async function main() {
  const { values } = parseArgs({
    options: {
      release: { type: 'boolean', default: false },
      out: { type: 'string' },
      'marketing-version': { type: 'string' },
    },
    strict: true,
  });
  const arch = nativeHostArch();
  if (values.release) {
    if (!values.out) throw new Error('--release needs --out <dir>.');
    const appVersion = values['marketing-version'] ?? (await packageVersion());
    await packAddons({ arch, outDir: path.resolve(values.out), urls: releaseUrlsFor(appVersion) });
    return;
  }
  if (values.out || values['marketing-version'])
    throw new Error('--out and --marketing-version apply to --release only.');
  // Imported here: only development stages Node and verifies on its own (a release pack is
  // verified by prepare-service-pack.mjs and the release workflow).
  const { stageNode } = await import('../service-pack/node-release.mjs');
  const { verifyAddons } = await import('../verify-app/addon-checks.mjs');
  const node = await stageNode({ repoRoot, arch, stageDir: path.join(repoRoot, 'tmp', 't7-node') });
  const { lockFile } = await packAddons({
    arch,
    outDir: DEV_ADDONS_DIR,
    urls: (artifact, file) => [pathToFileURL(file).href],
  });
  await verifyAddons({ node, lock: lockFile, dir: DEV_ADDONS_DIR, arch });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`addons: ${error.message}\n`);
    process.exit(1);
  }
}
