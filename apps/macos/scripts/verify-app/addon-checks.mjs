/**
 * The add-on checks (`verify-app.mjs addons`): every archive a lock pins for one architecture is
 * present in a directory with the pinned size and SHA-256, its URLs are the development `file:`
 * URL or the release mirror and GitHub URLs, and it is in the deterministic format the packer
 * writes (addons/archive.mjs) with an `addon.json` that lists exactly its other files, hashes,
 * sizes and modes. Each archive is then unpacked to a temporary directory and exercised:
 *
 * - `computer-browser`: no native code, the run-time packages hold exactly the files the packer
 *   keeps, and the given Node runs the worker (worker-check.mjs).
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXECUTABLE_MODE, FILE_MODE, readArchive } from '../addons/archive.mjs';
import {
  COMPUTER_BROWSER,
  MANIFEST_FILE,
  RUNTIME_PACKAGES,
  archiveName,
  releaseUrls,
  runtimePackageDir,
} from '../addons/layout.mjs';
import { checkBuildLock, checkManifest } from '../addons/schema.mjs';
import { findMachO } from './macho.mjs';
import { CHILD_ENV } from './pack-layout.mjs';
import { checkComputerWorker } from './worker-check.mjs';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const RELEASE_VERSION = /\/releases\/download\/v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\//;

/** All `file:` URLs naming `file` (development), or exactly the release URLs of one version. */
function checkUrls(artifact, file) {
  const { urls } = artifact;
  if (urls.every((url) => url.startsWith('file:'))) {
    const wrong = urls.filter((url) => fileURLToPath(url) !== file);
    if (wrong.length > 0) throw new Error(`${file}: the lock names ${wrong.join(', ')}.`);
    return 'development';
  }
  const version = RELEASE_VERSION.exec(urls[1] ?? '')?.[1];
  const expected = version === undefined ? [] : releaseUrls(artifact, version);
  if (urls.length !== 2 || urls.some((url, index) => url !== expected[index]))
    throw new Error(`${file}: the lock's URLs ${urls.join(', ')} are not the release URLs.`);
  return `release v${version}`;
}

/** Checks the archive's format and manifest against the lock entry; returns the manifest. */
function checkArchive(artifact, bytes, file) {
  const { gzipMtime, entries } = readArchive(bytes);
  if (gzipMtime !== 0) throw new Error(`${file}: the gzip header has mtime ${gzipMtime}.`);
  const [first, ...rest] = entries;
  if (first?.path !== MANIFEST_FILE) throw new Error(`${file}: ${MANIFEST_FILE} is not first.`);
  const manifest = JSON.parse(first.data.toString('utf8'));
  checkManifest(manifest, `${file} ${MANIFEST_FILE}`);
  for (const key of ['id', 'version', 'arch'])
    if (manifest[key] !== artifact[key])
      throw new Error(
        `${file}: ${MANIFEST_FILE} ${key} is ${manifest[key]}, the lock's ${artifact[key]}.`,
      );
  const listed = manifest.files.map((entry) => entry.path);
  const found = rest.map((entry) => entry.path);
  const sorted = listed.every((name, index) => index === 0 || listed[index - 1] < name);
  if (!sorted || found.length !== listed.length || found.some((name, i) => name !== listed[i]))
    throw new Error(`${file}: the entries after ${MANIFEST_FILE} are not its files in path order.`);
  const executables = new Set(manifest.executables);
  for (const [index, entry] of entries.entries()) {
    const mode = executables.has(entry.path) ? EXECUTABLE_MODE : FILE_MODE;
    if (
      entry.type !== '0' ||
      entry.mode !== mode ||
      entry.uid ||
      entry.gid ||
      entry.mtime ||
      entry.owners
    )
      throw new Error(
        `${file}: ${entry.path} is type ${entry.type}, mode ${entry.mode.toString(8)}, owner ${entry.uid}:${entry.gid} "${entry.owners}", mtime ${entry.mtime}; expected a regular file, mode ${mode.toString(8)}, owner 0:0, mtime 0.`,
      );
    if (index === 0) continue;
    const { sha256: hash, size } = manifest.files[index - 1];
    if (entry.data.length !== size || sha256(entry.data) !== hash)
      throw new Error(`${file}: ${entry.path} differs from its ${MANIFEST_FILE} hash or size.`);
  }
  const unpacked = entries.reduce((total, entry) => total + entry.data.length, 0);
  if (unpacked !== artifact.unpackedSize)
    throw new Error(
      `${file}: unpacks to ${unpacked} bytes, the lock says ${artifact.unpackedSize}.`,
    );
  return { manifest, entries };
}

async function unpack(entries, root) {
  for (const entry of entries) {
    const target = path.join(root, ...entry.path.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entry.data, { mode: entry.mode });
  }
}

async function checkBrowser({ root, manifest, node }) {
  const native = await findMachO([root]);
  if (native.length > 0)
    throw new Error(
      `${COMPUTER_BROWSER} holds native code: ${native.map((m) => m.file).join(', ')}`,
    );
  const paths = manifest.files.map((entry) => entry.path);
  for (const [name, keep] of Object.entries(RUNTIME_PACKAGES)) {
    const prefix = `${runtimePackageDir(name)}/`;
    const held = paths
      .filter((file) => file.startsWith(prefix))
      .map((file) => file.slice(prefix.length));
    if (held.length !== keep.length || !keep.every((file) => held.includes(file)))
      throw new Error(
        `${COMPUTER_BROWSER} must hold exactly ${keep.join(', ')} of ${name}; it holds ${held.join(', ')}.`,
      );
  }
  await checkComputerWorker({
    node,
    root,
    entry: path.join(root, manifest.entries.worker),
    env: CHILD_ENV,
  });
}

const CHECKS = { [COMPUTER_BROWSER]: checkBrowser };

/**
 * Verifies the archives `lock` (a lock file) pins for `arch` against the files in `dir`; `node`
 * runs the browser worker.
 */
export async function verifyAddons({ node, lock: lockFile, dir, arch }) {
  const lock = JSON.parse(await readFile(lockFile, 'utf8'));
  checkBuildLock(lock, arch, lockFile);
  const work = await mkdtemp(path.join(os.tmpdir(), 'atd-addons-check-'));
  try {
    for (const artifact of lock.addons) {
      const file = path.join(dir, archiveName(artifact));
      const bytes = await readFile(file);
      if (bytes.length !== artifact.size || sha256(bytes) !== artifact.sha256)
        throw new Error(`${file} does not match the lock's size and SHA-256.`);
      const kind = checkUrls(artifact, file);
      const { manifest, entries } = checkArchive(artifact, bytes, file);
      const root = path.join(work, artifact.id);
      await unpack(entries, root);
      await CHECKS[artifact.id]({ root, manifest, node });
      process.stdout.write(
        `${path.basename(file)}: ${artifact.size} bytes, ${manifest.files.length} files (${artifact.unpackedSize} unpacked), ${kind} URLs, deterministic format\n`,
      );
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
