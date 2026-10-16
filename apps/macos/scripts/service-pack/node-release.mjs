/**
 * Stages the official Node.js executable that runs the packaged service (tmp/t7-node, mapped to
 * Resources/node), pinned by the repository `.node-version` so development and the bundle run the
 * same release. Archives are checked against the release's SHASUMS256.txt and cached under
 * tmp/node-dist, so repeat packs work offline. Only the executable is shipped: the npm that
 * installs the packages generated apps declare ships as an exact `@atd/app-kit` dependency, and
 * npx and corepack are not shipped.
 */
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const NODE_RELEASES = 'https://nodejs.org/dist';

/** `[major, minor, patch]` of a Node version such as `v24.19.0`. */
function nodeTriple(raw) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(raw.trim());
  if (!match) throw new Error(`Unrecognized Node.js version: ${raw.trim() || '(empty)'}`);
  return match.slice(1).map(Number);
}

function compareTriples(left, right) {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

/**
 * Whether `version` satisfies an `engines.node` range made of `^x.y.z` and `>=x.y.z` clauses joined
 * by `||`, the only forms the service declares. Any other clause fails the pack.
 */
function nodeSatisfiesEngines(version, range) {
  const found = nodeTriple(version);
  return range.split('||').some((clause) => {
    const [, operator, min] = /^\s*(\^|>=)(\d+\.\d+\.\d+)\s*$/.exec(clause) ?? [];
    if (!operator) throw new Error(`Unsupported engines.node clause: ${clause}`);
    const lower = nodeTriple(min);
    if (compareTriples(found, lower) < 0) return false;
    return operator === '>=' || found[0] === lower[0];
  });
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${url} (HTTP ${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Returns `verify`'s result for `file`, downloading it on a cache miss. `verify` runs on every
 * read and before a download is cached, so a corrupted or replaced cache fails the pack instead of
 * being shipped.
 */
async function cached(file, url, verify) {
  let existing = null;
  try {
    existing = await readFile(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const bytes = existing ?? (await download(url));
  const result = verify(bytes);
  if (existing === null) {
    await writeFile(`${file}.part`, bytes);
    await rename(`${file}.part`, file);
  }
  return result;
}

/**
 * Downloads (or reads from the cache), verifies and stages the pinned Node for `arch` (a Node
 * architecture name) into `stageDir`, returning the staged executable. Its path inside the stage
 * matches `ServiceLaunchPlan`.
 */
export async function stageNode({ repoRoot, arch, stageDir }) {
  const version = (await readFile(path.join(repoRoot, '.node-version'), 'utf8')).trim();
  const manifest = path.join(repoRoot, 'apps', 'agent-service', 'package.json');
  const { engines } = JSON.parse(await readFile(manifest, 'utf8'));
  if (!nodeSatisfiesEngines(version, engines.node))
    throw new Error(
      `.node-version ${version} does not satisfy @atd/agent-service engines.node ${engines.node}.`,
    );

  const base = `node-v${version}-darwin-${arch}`;
  const archive = { name: `${base}.tar.gz`, member: `${base}/bin/node` };
  const cacheDir = path.join(repoRoot, 'tmp', 'node-dist', `v${version}`);
  await mkdir(cacheDir, { recursive: true });
  const releaseUrl = `${NODE_RELEASES}/v${version}`;
  const expected = await cached(
    path.join(cacheDir, 'SHASUMS256.txt'),
    `${releaseUrl}/SHASUMS256.txt`,
    (bytes) => {
      const sum = bytes
        .toString('utf8')
        .split('\n')
        .map((line) => line.trim().split(/\s+/))
        .find(([, name]) => name === archive.name)?.[0];
      if (!sum) throw new Error(`SHASUMS256.txt for v${version} lists no ${archive.name}.`);
      return sum;
    },
  );
  const archiveFile = path.join(cacheDir, archive.name);
  await cached(archiveFile, `${releaseUrl}/${archive.name}`, (bytes) => {
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== expected)
      throw new Error(`${archive.name} sha256 ${actual} does not match ${expected}.`);
  });
  process.stdout.write(`Verified ${archive.name} sha256 ${expected}\n`);

  const extractDir = path.join(cacheDir, 'extract');
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });
  const tar = spawnSync('tar', ['-xf', archiveFile, '-C', extractDir, archive.member], {
    stdio: 'inherit',
  });
  if (tar.status !== 0) throw new Error(`Could not extract ${archive.member} from ${archiveFile}.`);

  const target = path.join(stageDir, 'bin', 'node');
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(extractDir, archive.member), target);
  await chmod(target, 0o755);
  await rm(extractDir, { recursive: true, force: true });

  const probe = spawnSync(target, ['--version'], { encoding: 'utf8' });
  if (probe.status !== 0 || probe.stdout.trim() !== `v${version}`)
    throw new Error(`Staged Node at ${target} did not report v${version}.`);
  process.stdout.write(`Staged Node ${probe.stdout.trim()} at ${target}\n`);
  return target;
}
