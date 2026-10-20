import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { extract, ReadEntry } from 'tar';
import {
  AddonManifestSchema,
  errorMessage,
  parse,
  type AddonArtifact,
  type AddonManifest,
} from '@atd/agent-contracts';
import { AddonFailure } from './failure.js';
import { MANIFEST_FILE } from './store.js';

const FILE_TYPES = new Set(['File', 'OldFile', 'ContiguousFile']);

const reject = (message: string) => new AddonFailure('integrity', message);

/**
 * The archive member path as a relative `/` path inside the add-on ('' for the root itself), or
 * null for an absolute path, a `..` segment or anything that does not normalize to itself.
 */
function memberPath(raw: string): string | null {
  const trimmed = raw.replace(/^\.\//, '').replace(/\/$/, '');
  if (trimmed === '' || trimmed === '.') return '';
  if (path.posix.isAbsolute(trimmed) || path.posix.normalize(trimmed) !== trimmed) return null;
  return trimmed.split('/').some((part) => part === '..' || part === '.') ? null : trimmed;
}

/**
 * Unpacks a verified archive into `tree` (a new staging directory) and checks it against its own
 * `addon.json` and the lock: only regular files and directories may be unpacked, every one inside
 * the root and within the lock's `unpackedSize`; the manifest must name the lock's id,
 * architecture and version; the tree must hold exactly the files it lists (plus `addon.json`),
 * each with its size and hash; entries and executables must be listed files. Modes are then set
 * from the manifest alone. Any deviation rejects the archive with `integrity`.
 */
export async function unpackArchive(
  archive: string,
  tree: string,
  artifact: AddonArtifact,
  signal: AbortSignal,
): Promise<AddonManifest> {
  await mkdir(tree, { recursive: true });
  let failure: AddonFailure | undefined;
  let unpacked = 0;
  await extract({
    file: archive,
    cwd: tree,
    strict: true,
    preserveOwner: false,
    filter(raw, entry) {
      if (failure) return false;
      const member = memberPath(raw);
      if (!(entry instanceof ReadEntry) || member === null) {
        failure = reject(`The archive holds a path outside the add-on: ${raw}`);
        return false;
      }
      if (entry.type === 'Directory') return true;
      if (!FILE_TYPES.has(entry.type)) {
        failure = reject(`The archive holds a ${entry.type} entry, which add-ons may not contain.`);
        return false;
      }
      unpacked += entry.size;
      if (unpacked > artifact.unpackedSize) {
        failure = reject('The archive unpacks to more than this build expects.');
        return false;
      }
      return true;
    },
  }).catch((error: unknown) => {
    throw failure ?? reject(`The archive could not be unpacked: ${errorMessage(error)}`);
  });
  if (failure) throw failure;
  signal.throwIfAborted();
  const manifest = await readManifest(tree, artifact);
  await checkTree(tree, manifest, signal);
  await setModes(tree, manifest);
  return manifest;
}

async function readManifest(tree: string, artifact: AddonArtifact): Promise<AddonManifest> {
  let manifest: AddonManifest;
  try {
    manifest = parse(
      AddonManifestSchema,
      JSON.parse(await readFile(path.join(tree, MANIFEST_FILE), 'utf8')),
    );
  } catch (error) {
    throw reject(`The archive's ${MANIFEST_FILE} is missing or invalid: ${errorMessage(error)}`);
  }
  if (
    manifest.id !== artifact.id ||
    manifest.arch !== artifact.arch ||
    manifest.version !== artifact.version
  )
    throw reject(`The archive's ${MANIFEST_FILE} names another add-on, version or architecture.`);
  const listed = new Set(manifest.files.map((file) => file.path));
  if (listed.size !== manifest.files.length || listed.has(MANIFEST_FILE))
    throw reject(`The archive's ${MANIFEST_FILE} lists a file twice or lists itself.`);
  for (const named of [...Object.values(manifest.entries), ...manifest.executables])
    if (!listed.has(named)) throw reject(`The archive's ${MANIFEST_FILE} names an unlisted file.`);
  return manifest;
}

/** Every file under `dir` as a relative `/` path; any link or special file rejects the tree. */
async function walk(root: string, dir = ''): Promise<string[]> {
  const files: string[] = [];
  for (const name of await readdir(path.join(root, dir))) {
    const relative = dir ? `${dir}/${name}` : name;
    const stats = await lstat(path.join(root, relative));
    if (stats.isDirectory()) files.push(...(await walk(root, relative)));
    else if (stats.isFile()) files.push(relative);
    else throw reject(`The archive unpacked a link or special file: ${relative}`);
  }
  return files;
}

async function checkTree(tree: string, manifest: AddonManifest, signal: AbortSignal) {
  const present = new Set(await walk(tree));
  present.delete(MANIFEST_FILE);
  if (present.size !== manifest.files.length)
    throw reject(`The archive holds files its ${MANIFEST_FILE} does not list, or lacks some.`);
  for (const file of manifest.files) {
    signal.throwIfAborted();
    if (!present.has(file.path)) throw reject(`The archive lacks ${file.path}.`);
    const target = path.join(tree, file.path);
    if ((await lstat(target)).size !== file.size || (await sha256Of(target)) !== file.sha256)
      throw reject(`${file.path} does not match the archive's ${MANIFEST_FILE}.`);
  }
}

async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Executables 0755, every other file 0644, directories 0755, whatever the archive said. */
async function setModes(tree: string, manifest: AddonManifest): Promise<void> {
  const executables = new Set(manifest.executables);
  for (const file of [...manifest.files.map((item) => item.path), MANIFEST_FILE])
    await chmod(path.join(tree, file), executables.has(file) ? 0o755 : 0o644);
  const dirs = new Set<string>();
  for (const file of manifest.files)
    for (let dir = path.posix.dirname(file.path); dir !== '.'; dir = path.posix.dirname(dir))
      dirs.add(dir);
  for (const dir of [...dirs, '']) await chmod(path.join(tree, dir), 0o755);
}
