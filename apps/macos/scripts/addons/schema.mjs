/**
 * Structural checks for `addon.json` (AddonManifest) and `addons.lock.json` (AddonLock), mirroring
 * `packages/agent-contracts/src/addons.ts`. verify-app runs from a checkout without node_modules,
 * so it cannot load typebox; keep these patterns and limits equal to the contract's. Each check
 * throws naming the first field it found wrong.
 */
import { ADDON_IDS } from './layout.mjs';

const ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const RELATIVE_PATH = /^(?!\/)(?!.*(^|\/)\.{1,2}(\/|$))[A-Za-z0-9._@+-]+(\/[A-Za-z0-9._@+-]+)*$/;
const ENTRY_NAME = /^[a-z][a-zA-Z0-9]*$/;
const URL_PATTERN = /^(https|file):/;
const ARCHS = new Set(['arm64', 'x64']);
/** `ADDON_MAX_BYTES`. */
export const ADDON_MAX_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 8;
const MAX_FILES = 2000;
const MAX_LOCK_ADDONS = 32;

function fail(where, problem) {
  throw new Error(`${where}: ${problem}`);
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value, keys, where) {
  if (!isObject(value)) fail(where, 'must be an object');
  const extra = Object.keys(value).filter((key) => !keys.includes(key));
  const missing = keys.filter((key) => !(key in value));
  if (extra.length > 0) fail(where, `unexpected ${extra.join(', ')}`);
  if (missing.length > 0) fail(where, `missing ${missing.join(', ')}`);
}

function string(value, where, { pattern, min = 0, max }) {
  if (typeof value !== 'string') fail(where, 'must be a string');
  if (value.length < min || value.length > max) fail(where, `length must be ${min}–${max}`);
  if (pattern && !pattern.test(value)) fail(where, `${JSON.stringify(value)} is malformed`);
}

function integer(value, where, min, max) {
  if (!Number.isInteger(value) || value < min || value > max)
    fail(where, `must be an integer in ${min}–${max}`);
}

function array(value, where, { min = 0, max }) {
  if (!Array.isArray(value)) fail(where, 'must be an array');
  if (value.length < min || value.length > max) fail(where, `must hold ${min}–${max} items`);
}

const id = (value, where) => string(value, where, { pattern: ID, max: 64 });
const version = (value, where) => string(value, where, { min: 1, max: 64 });
const sha256 = (value, where) => string(value, where, { pattern: SHA256, max: 64 });
const relativePath = (value, where) => string(value, where, { pattern: RELATIVE_PATH, max: 512 });

function arch(value, where) {
  if (!ARCHS.has(value)) fail(where, `must be arm64 or x64, not ${JSON.stringify(value)}`);
}

/** Checks one `AddonArtifact`. */
export function checkArtifact(artifact, where = 'artifact') {
  exactKeys(artifact, ['id', 'version', 'arch', 'sha256', 'size', 'unpackedSize', 'urls'], where);
  id(artifact.id, `${where}.id`);
  version(artifact.version, `${where}.version`);
  arch(artifact.arch, `${where}.arch`);
  sha256(artifact.sha256, `${where}.sha256`);
  integer(artifact.size, `${where}.size`, 1, ADDON_MAX_BYTES);
  integer(artifact.unpackedSize, `${where}.unpackedSize`, 1, ADDON_MAX_BYTES);
  array(artifact.urls, `${where}.urls`, { min: 1, max: 4 });
  artifact.urls.forEach((url, index) =>
    string(url, `${where}.urls[${index}]`, { pattern: URL_PATTERN, max: 2048 }),
  );
}

/** Checks an `AddonLock`, plus the one-archive-per-id-and-architecture rule its doc states. */
export function checkLock(lock, where = 'addons.lock.json') {
  exactKeys(lock, ['schemaVersion', 'addons'], where);
  if (lock.schemaVersion !== 1) fail(`${where}.schemaVersion`, 'must be 1');
  array(lock.addons, `${where}.addons`, { max: MAX_LOCK_ADDONS });
  const seen = new Set();
  lock.addons.forEach((artifact, index) => {
    checkArtifact(artifact, `${where}.addons[${index}]`);
    const key = `${artifact.id}/${artifact.arch}`;
    if (seen.has(key)) fail(where, `lists ${key} twice`);
    seen.add(key);
  });
}

/** Checks an `AddonManifest`, plus that its entries and executables name listed files. */
export function checkManifest(manifest, where = 'addon.json') {
  exactKeys(
    manifest,
    ['schemaVersion', 'id', 'version', 'arch', 'entries', 'executables', 'files'],
    where,
  );
  if (manifest.schemaVersion !== 1) fail(`${where}.schemaVersion`, 'must be 1');
  id(manifest.id, `${where}.id`);
  version(manifest.version, `${where}.version`);
  arch(manifest.arch, `${where}.arch`);
  if (!isObject(manifest.entries)) fail(`${where}.entries`, 'must be an object');
  const entries = Object.entries(manifest.entries);
  if (entries.length > MAX_ENTRIES) fail(`${where}.entries`, `holds more than ${MAX_ENTRIES}`);
  for (const [name, file] of entries) {
    string(name, `${where}.entries key`, { pattern: ENTRY_NAME, max: 32 });
    relativePath(file, `${where}.entries.${name}`);
  }
  array(manifest.executables, `${where}.executables`, { max: MAX_ENTRIES });
  manifest.executables.forEach((file, index) =>
    relativePath(file, `${where}.executables[${index}]`),
  );
  array(manifest.files, `${where}.files`, { min: 1, max: MAX_FILES });
  const listed = new Set();
  manifest.files.forEach((file, index) => {
    const at = `${where}.files[${index}]`;
    exactKeys(file, ['path', 'sha256', 'size'], at);
    relativePath(file.path, `${at}.path`);
    sha256(file.sha256, `${at}.sha256`);
    integer(file.size, `${at}.size`, 0, ADDON_MAX_BYTES);
    if (listed.has(file.path)) fail(at, `lists ${file.path} twice`);
    listed.add(file.path);
  });
  for (const file of [...Object.values(manifest.entries), ...manifest.executables])
    if (!listed.has(file)) fail(where, `names ${file}, which files does not list`);
}

/**
 * Checks the lock a build ships or packs: a valid AddonLock that pins exactly one archive of every
 * add-on in `ADDON_IDS`, all for `arch`, the architecture of the app that carries it.
 */
export function checkBuildLock(lock, arch, where) {
  checkLock(lock, where);
  const ids = lock.addons.map((artifact) => artifact.id).sort();
  if (
    lock.addons.some((artifact) => artifact.arch !== arch) ||
    ids.join() !== [...ADDON_IDS].sort().join()
  )
    throw new Error(`${where} must pin exactly ${ADDON_IDS.join(', ')} for ${arch}.`);
}
