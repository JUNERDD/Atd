#!/usr/bin/env node
/**
 * Stages what the Release app embeds beside the renderer (project.yml's "Embed renderer and
 * service" phase): `pnpm deploy --prod --legacy` of the built service into gitignored tmp/, so the
 * bundle carries production node_modules without applying files:["dist"]. The workspace lockfile
 * is snapshotted and restored; a demanded lockfile write is a hard failure (do not keep it).
 *
 * pnpm < 12.7.0 also rewrites the source workspace's
 * node_modules/.pnpm-workspace-state-v1.json during a legacy deploy, recording
 * only the deployed project with production settings. The next `pnpm run` or
 * `pnpm exec` in the workspace then sees stale state and reinstalls without
 * devDependencies, emptying node_modules/.bin (pnpm/pnpm#15352). The state
 * file is restored byte for byte after the deploy; drop that once the pinned
 * pnpm includes the upstream fix.
 *
 * It also stages the official Node.js executable that runs the packaged
 * service (tmp/t7-node, mapped to Resources/node), pinned by the repository
 * `.node-version` so development and the bundle run the same release. Archives
 * are checked against the release's SHASUMS256.txt and cached under
 * tmp/node-dist, so repeat packs work offline. Only the executable is shipped:
 * whether the app bundles npm/npx is undecided. The target is the build host's
 * architecture on macOS, the only platform the app ships for.
 *
 * Every run writes a fresh build-info.json into the pack, identifying this
 * packaged service build.
 */
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const packDir = path.join(repoRoot, 'tmp', 't7-agent-service-pack');
const lockFile = path.join(repoRoot, 'pnpm-lock.yaml');
const lockBak = path.join(repoRoot, 'tmp', 't7-lockfile.bak');
const workspaceState = path.join(repoRoot, 'node_modules', '.pnpm-workspace-state-v1.json');
const cli = path.join(repoRoot, 'apps', 'agent-service', 'dist', 'cli.js');
const contracts = path.join(repoRoot, 'packages', 'agent-contracts', 'dist', 'index.js');
const client = path.join(repoRoot, 'packages', 'agent-client', 'dist', 'index.js');
const nodeVersionFile = path.join(repoRoot, '.node-version');
const serviceManifest = path.join(repoRoot, 'apps', 'agent-service', 'package.json');
const nodeCache = path.join(repoRoot, 'tmp', 'node-dist');
const nodeStage = path.join(repoRoot, 'tmp', 't7-node');
const nodeRelease = 'https://nodejs.org/dist';

async function hashFile(file) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

/** Returns the file's bytes, or null when it does not exist. */
async function readIfPresent(file) {
  try {
    return await readFile(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

/** Puts `file` back to a `readIfPresent` snapshot, removing it if it was absent. */
async function restoreSnapshot(file, bytes) {
  if (bytes === null) await rm(file, { force: true });
  else await writeFile(file, bytes, { mode: 0o600 });
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** `[major, minor, patch]` of a Node version such as `v24.19.0`. */
function nodeTriple(raw) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(raw.trim());
  if (!match) fail(`Unrecognized Node.js version: ${raw.trim() || '(empty)'}`);
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
    if (!operator) fail(`Unsupported engines.node clause: ${clause}`);
    const lower = nodeTriple(min);
    if (compareTriples(found, lower) < 0) return false;
    return operator === '>=' || found[0] === lower[0];
  });
}

/** Release archive for the host; the executable's path inside it matches `ServiceLaunchPlan`. */
function nodeArchive(version) {
  if (process.platform !== 'darwin' || !['x64', 'arm64'].includes(process.arch))
    fail(`The service pack is built on macOS only, not ${process.platform}-${process.arch}.`);
  const base = `node-v${version}-darwin-${process.arch}`;
  return { name: `${base}.tar.gz`, member: `${base}/bin/node`, staged: path.join('bin', 'node') };
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) fail(`Download failed: ${url} (HTTP ${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Returns `verify`'s result for `file`, downloading it on a cache miss.
 * `verify` runs on every read and before a download is cached, so a corrupted
 * or replaced cache fails the pack instead of being shipped.
 */
async function cached(file, url, verify) {
  const existing = await readIfPresent(file);
  const bytes = existing ?? (await download(url));
  const result = verify(bytes);
  if (existing === null) {
    await writeFile(`${file}.part`, bytes);
    await rename(`${file}.part`, file);
  }
  return result;
}

async function stageNode() {
  const version = (await readFile(nodeVersionFile, 'utf8')).trim();
  const { engines } = JSON.parse(await readFile(serviceManifest, 'utf8'));
  if (!nodeSatisfiesEngines(version, engines.node))
    fail(
      `.node-version ${version} does not satisfy @atd/agent-service engines.node ${engines.node}.`,
    );

  const archive = nodeArchive(version);
  const cacheDir = path.join(nodeCache, `v${version}`);
  await mkdir(cacheDir, { recursive: true });
  const releaseUrl = `${nodeRelease}/v${version}`;
  const expected = await cached(
    path.join(cacheDir, 'SHASUMS256.txt'),
    `${releaseUrl}/SHASUMS256.txt`,
    (bytes) => {
      const sum = bytes
        .toString('utf8')
        .split('\n')
        .map((line) => line.trim().split(/\s+/))
        .find(([, name]) => name === archive.name)?.[0];
      if (!sum) fail(`SHASUMS256.txt for v${version} lists no ${archive.name}.`);
      return sum;
    },
  );
  const archiveFile = path.join(cacheDir, archive.name);
  await cached(archiveFile, `${releaseUrl}/${archive.name}`, (bytes) => {
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== expected) fail(`${archive.name} sha256 ${actual} does not match ${expected}.`);
  });
  process.stdout.write(`Verified ${archive.name} sha256 ${expected}\n`);

  const extractDir = path.join(cacheDir, 'extract');
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });
  const tar = spawnSync('tar', ['-xf', archiveFile, '-C', extractDir, archive.member], {
    stdio: 'inherit',
  });
  if (tar.status !== 0) fail(`Could not extract ${archive.member} from ${archiveFile}.`);

  const target = path.join(nodeStage, archive.staged);
  await rm(nodeStage, { recursive: true, force: true });
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(extractDir, archive.member), target);
  await chmod(target, 0o755);
  await rm(extractDir, { recursive: true, force: true });

  const probe = spawnSync(target, ['--version'], { encoding: 'utf8' });
  if (probe.status !== 0 || probe.stdout.trim() !== `v${version}`)
    fail(`Staged Node at ${target} did not report v${version}.`);
  process.stdout.write(`Staged Node ${probe.stdout.trim()} at ${target}\n`);
}

for (const file of [cli, contracts, client]) {
  try {
    await access(file);
  } catch {
    process.stderr.write(`Missing built file ${file}. Run \`pnpm build\` before packaging.\n`);
    process.exit(1);
  }
}

await stageNode();
await mkdir(path.dirname(packDir), { recursive: true });
await copyFile(lockFile, lockBak);
const lockBefore = await hashFile(lockFile);
const workspaceStateBefore = await readIfPresent(workspaceState);
await rm(packDir, { recursive: true, force: true });

const deploy = spawnSync(
  'pnpm',
  ['--filter', '@atd/agent-service', 'deploy', '--prod', '--legacy', packDir],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, npm_config_lockfile: 'false' },
  },
);
// Restore before any exit below so a failed deploy cannot leave it either.
await restoreSnapshot(workspaceState, workspaceStateBefore);
const lockAfter = await hashFile(lockFile);
if (lockAfter !== lockBefore) {
  await copyFile(lockBak, lockFile);
  process.stderr.write(
    'pnpm deploy mutated pnpm-lock.yaml; restored snapshot. BLOCK: deploy demanded a workspace lockfile write.\n',
  );
  process.exit(1);
}
if (deploy.status !== 0) process.exit(deploy.status ?? 1);

const stagedModules = path.join(packDir, 'node_modules');
try {
  await access(path.join(packDir, 'dist', 'cli.js'));
  await access(stagedModules);
} catch {
  process.stderr.write('pnpm deploy did not produce dist/cli.js + node_modules.\n');
  process.exit(1);
}

const piIndex = path.join(stagedModules, '@earendil-works', 'pi-coding-agent', 'dist', 'index.js');
try {
  await access(piIndex);
} catch {
  process.stderr.write(`Staged node_modules missing Pi at ${piIndex}\n`);
  process.exit(1);
}
const resolved = await realpath(piIndex);
if (!resolved.startsWith(packDir)) {
  process.stderr.write(`Staged Pi resolved outside pack (${resolved}).\n`);
  process.exit(1);
}
// The file index addon is built for darwin-arm64 only (packages/file-index); without it that
// pack would ship a service whose file search reports itself unavailable.
if (process.arch === 'arm64') {
  const addon = path.join(stagedModules, '@atd', 'file-index', 'file-index.darwin-arm64.node');
  try {
    await access(addon);
  } catch {
    fail(`Staged node_modules missing the file index addon at ${addon}. Run \`pnpm build\`.`);
  }
  process.stdout.write(`File index addon: ${await realpath(addon)}\n`);
}
// The packaged service runs without --enable-source-maps, so the dependencies' source maps are
// never read; dropping them removes about a sixth of the files the app embeds, signs and
// compresses. Unlinking leaves the pnpm store copies alone. Type declarations, TypeScript sources
// and docs stay: Pi and its extensions can read them at runtime.
let sourceMaps = 0;
for (const entry of await readdir(stagedModules, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.map')) continue;
  await rm(path.join(entry.parentPath, entry.name));
  sourceMaps += 1;
}
process.stdout.write(`Removed ${sourceMaps} dependency source maps\n`);
const buildInfo = { version: 1, buildId: randomUUID() };
await writeFile(path.join(packDir, 'build-info.json'), `${JSON.stringify(buildInfo, null, 2)}\n`);
process.stdout.write(
  `Staged service pack at ${packDir}\nPi: ${resolved}\nBuild: ${buildInfo.buildId}\n`,
);
