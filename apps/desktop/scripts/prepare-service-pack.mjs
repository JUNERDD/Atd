#!/usr/bin/env node
/**
 * T7 packaging prepare: drop stale Electron worker outputs, then `pnpm deploy
 * --prod --legacy` the built service into gitignored tmp/ so extraResources
 * can copy production node_modules without applying files:["dist"].
 * The workspace lockfile is snapshotted and restored; a demanded lockfile
 * write is a hard failure (do not keep it).
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
 * platform and architecture; the release workflow packages each architecture
 * on its own runner.
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
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeSatisfiesEngines } from '../electron/service/node-runtime.ts';

const desktopRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(desktopRoot, '../..');
const packDir = path.join(repoRoot, 'tmp', 't7-agent-service-pack');
const lockFile = path.join(repoRoot, 'pnpm-lock.yaml');
const lockBak = path.join(repoRoot, 'tmp', 't7-lockfile.bak');
const workspaceState = path.join(repoRoot, 'node_modules', '.pnpm-workspace-state-v1.json');
const cli = path.join(repoRoot, 'apps', 'agent-service', 'dist', 'cli.js');
const contracts = path.join(repoRoot, 'packages', 'agent-contracts', 'dist', 'index.js');
const client = path.join(repoRoot, 'packages', 'agent-client', 'dist', 'index.js');
const distElectron = path.join(desktopRoot, 'dist-electron');
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

/** Release archive for the host; the executable's path inside it matches `resolveServiceNode`. */
function nodeArchive(version) {
  const platform = { darwin: 'darwin', linux: 'linux', win32: 'win' }[process.platform];
  if (!platform || !['x64', 'arm64'].includes(process.arch))
    fail(`No official Node.js build is mapped for ${process.platform}-${process.arch}.`);
  const base = `node-v${version}-${platform}-${process.arch}`;
  return platform === 'win'
    ? { name: `${base}.zip`, member: `${base}/node.exe`, staged: 'node.exe' }
    : { name: `${base}.tar.gz`, member: `${base}/bin/node`, staged: path.join('bin', 'node') };
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
      `.node-version ${version} does not satisfy @ai/agent-service engines.node ${engines.node}.`,
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
  // bsdtar (macOS, Windows 10+) and GNU tar both extract a single member; bsdtar also reads zip.
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

async function clearStaleWorkers() {
  let names = [];
  try {
    names = await readdir(distElectron);
  } catch {
    return;
  }
  await Promise.all(
    names
      .filter((name) => name.startsWith('worker') && name.endsWith('.js'))
      .map((name) => unlink(path.join(distElectron, name))),
  );
}

for (const file of [cli, contracts, client]) {
  try {
    await access(file);
  } catch {
    process.stderr.write(`Missing built file ${file}. Run \`pnpm build\` before packaging.\n`);
    process.exit(1);
  }
}

await clearStaleWorkers();
await stageNode();
await mkdir(path.dirname(packDir), { recursive: true });
await copyFile(lockFile, lockBak);
const lockBefore = await hashFile(lockFile);
const workspaceStateBefore = await readIfPresent(workspaceState);
await rm(packDir, { recursive: true, force: true });

const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const deploy = spawnSync(
  pnpm,
  ['--filter', '@ai/agent-service', 'deploy', '--prod', '--legacy', packDir],
  {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_lockfile: 'false',
      // The deploy installs only the service's production dependencies, so workspace patches
      // for other projects' packages (such as the desktop build's @electron/osx-sign) are
      // legitimately unused here; pnpm 12 reads this setting only with the pnpm_config_ prefix.
      pnpm_config_allow_unused_patches: 'true',
    },
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
if (process.platform === 'darwin' && process.arch === 'arm64') {
  const addon = path.join(stagedModules, '@ai', 'file-index', 'file-index.darwin-arm64.node');
  try {
    await access(addon);
  } catch {
    fail(`Staged node_modules missing the file index addon at ${addon}. Run \`pnpm build\`.`);
  }
  process.stdout.write(`File index addon: ${await realpath(addon)}\n`);
}
const buildInfo = { version: 1, buildId: randomUUID() };
await writeFile(path.join(packDir, 'build-info.json'), `${JSON.stringify(buildInfo, null, 2)}\n`);
process.stdout.write(
  `Staged service pack at ${packDir}\nPi: ${resolved}\nBuild: ${buildInfo.buildId}\n`,
);
