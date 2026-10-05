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
 * The pack also carries the generated-app toolchain (`@atd/app-kit` with Vite, Rolldown,
 * Tailwind, the native TypeScript compiler and the packages apps may import), which the service
 * runs offline from inside the bundle. Dependency links that toolchain never follows are cut and
 * store entries nothing links to any more are deleted (`pruneStore`); the pruned pack must then
 * typecheck and build the app template and pass the backend sandbox self-check under the bundled
 * Node (`checkAppToolchain`), and every native binary it can run must carry a valid signature
 * (`checkNativeSignatures`), or the pack fails.
 *
 * Every run writes a fresh build-info.json into the pack, identifying this
 * packaged service build.
 */
import {
  access,
  chmod,
  copyFile,
  mkdir,
  open,
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
import { fileURLToPath, pathToFileURL } from 'node:url';

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

/**
 * Dependency links, by the package that declares them, that neither the service nor an app build
 * ever follows. Each rule must still match a staged package, so a dependency change that makes one
 * stale fails the pack instead of silently shipping more.
 */
const UNUSED_LINKS = new Map([
  // Optional peers: the builder passes Vite an inline config (no config file for jiti or yaml to
  // load), never asks for esbuild transforms, and never watches (fsevents).
  ['vite', ['esbuild', 'fsevents', 'jiti', 'yaml']],
  // Optional peers for the Babel pipeline and the React Compiler, which app builds do not enable.
  [
    '@vitejs/plugin-react',
    ['@rolldown/plugin-babel', 'babel-plugin-react-compiler', 'oxc-transform-react'],
  ],
  // @atd/ui uses the shadcn CLI package only for `shadcn/tailwind.css`, which app-kit vendors.
  ['@atd/ui', ['shadcn']],
]);

/**
 * Files of kept packages that nothing loads: Vite resolves lucide-react through its `module`
 * (ESM) entry and `tsc` through its `typings`, so the CommonJS build and the prefixed/suffixed
 * declaration variants (whose names the main declaration file already exports) go.
 */
const UNUSED_FILES = new Map([
  [
    'lucide-react',
    ['dist/cjs', 'dist/lucide-react.prefixed.d.ts', 'dist/lucide-react.suffixed.d.ts'],
  ],
]);

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
  return target;
}

/** True when `file` is `root` or lies inside it. */
function isInside(file, root) {
  return file === root || file.startsWith(`${root}${path.sep}`);
}

/** The packages in a `node_modules` directory (scopes expanded), skipping `.bin` and the like. */
async function packageEntries(modulesDir) {
  let entries;
  try {
    entries = await readdir(modulesDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const packages = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(modulesDir, entry.name);
    const scoped = entry.name.startsWith('@') && entry.isDirectory();
    const children = scoped ? await readdir(full, { withFileTypes: true }) : [entry];
    for (const child of children) {
      packages.push({
        name: scoped ? `${entry.name}/${child.name}` : child.name,
        path: scoped ? path.join(full, child.name) : full,
        link: child.isSymbolicLink(),
      });
    }
  }
  return packages;
}

/** The virtual-store entry (`.pnpm/<id>`) holding a package directory, or null outside it. */
function storeEntry(store, dir) {
  if (!isInside(dir, store)) return null;
  const parts = path.relative(store, dir).split(path.sep);
  const at = parts.indexOf('node_modules');
  return at > 0 ? path.join(store, ...parts.slice(0, at)) : null;
}

/**
 * Cuts the `UNUSED_LINKS`, then keeps only the virtual-store entries Node can still reach from
 * the pack's own dependencies through declared links, deletes the rest (including the unlinked
 * `.pnpm/@` copies pnpm 12's legacy deploy leaves) and the hoisted fallback links to them, and
 * trims `UNUSED_FILES` from what stays.
 */
async function pruneStore(modules) {
  const store = path.join(modules, '.pnpm');
  const live = new Set();
  const pending = [];
  const matchedRules = new Set();
  let cut = 0;
  const follow = async (modulesDir, unused) => {
    for (const dep of await packageEntries(modulesDir)) {
      if (!dep.link) {
        await follow(path.join(dep.path, 'node_modules'), []);
      } else if (unused.includes(dep.name)) {
        await rm(dep.path);
        cut += 1;
      } else {
        const entry = storeEntry(store, await realpath(dep.path));
        if (entry !== null && !live.has(entry)) {
          live.add(entry);
          pending.push(entry);
        }
      }
    }
  };
  await follow(modules, []);
  for (let entry = pending.pop(); entry !== undefined; entry = pending.pop()) {
    const entryModules = path.join(entry, 'node_modules');
    const own = (await packageEntries(entryModules)).filter((dep) => !dep.link);
    const unused = own.flatMap((pkg) => {
      if (UNUSED_LINKS.has(pkg.name)) matchedRules.add(pkg.name);
      return UNUSED_LINKS.get(pkg.name) ?? [];
    });
    await follow(entryModules, unused);
    for (const pkg of own) {
      for (const file of UNUSED_FILES.get(pkg.name) ?? []) {
        await rm(path.join(pkg.path, file), { recursive: true });
      }
    }
  }
  const stale = [...UNUSED_LINKS.keys()].filter((name) => !matchedRules.has(name));
  if (stale.length > 0)
    fail(`UNUSED_LINKS names packages the pack no longer has: ${stale.join(', ')}.`);

  let removed = 0;
  const removeDead = async (dir) => {
    for (const child of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, child.name);
      if (!child.isDirectory() || full === path.join(store, 'node_modules') || live.has(full))
        continue;
      if ([...live].some((entry) => isInside(entry, full))) {
        await removeDead(full);
      } else {
        await rm(full, { recursive: true });
        removed += 1;
      }
    }
  };
  await removeDead(store);
  const hoisted = path.join(store, 'node_modules');
  for (const dep of await packageEntries(hoisted)) {
    if (
      dep.link &&
      !(await access(dep.path).then(
        () => true,
        () => false,
      ))
    )
      await rm(dep.path);
  }
  for (const scope of await readdir(hoisted).catch(() => [])) {
    if (scope.startsWith('@') && (await readdir(path.join(hoisted, scope))).length === 0)
      await rm(path.join(hoisted, scope), { recursive: true });
  }
  process.stdout.write(
    `Pruned the virtual store: cut ${cut} unused links, kept ${live.size} entries, removed ${removed}\n`,
  );
}

/**
 * Fails the pack if a Mach-O file that can run on this host lacks a valid signature. The app's
 * ad hoc signature seals everything under Resources by hash but does not sign nested code, and
 * Apple silicon refuses to load an unsigned binary: the Node executable, the native TypeScript
 * compiler and the addons (Rolldown, Lightning CSS, Tailwind's oxide, the file index) must each
 * arrive signed (linker-signed counts). Slices for other architectures are never loaded.
 */
async function checkNativeSignatures(dirs) {
  const hostArch = process.arch === 'x64' ? 'x86_64' : process.arch;
  const machO = new Set(['cffaedfe', 'cafebabe']);
  const unsigned = [];
  let checked = 0;
  for (const dir of dirs) {
    for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const file = path.join(entry.parentPath, entry.name);
      const handle = await open(file);
      const { bytesRead, buffer } = await handle.read(Buffer.alloc(4), 0, 4, 0);
      await handle.close();
      if (bytesRead < 4 || !machO.has(buffer.toString('hex'))) continue;
      const archs = spawnSync('lipo', ['-archs', file], { encoding: 'utf8' });
      if (archs.status !== 0 || !archs.stdout.trim().split(/\s+/).includes(hostArch)) continue;
      checked += 1;
      const verify = spawnSync('codesign', ['--verify', '--strict', '--arch', hostArch, file]);
      if (verify.status !== 0) unsigned.push(file);
    }
  }
  if (unsigned.length > 0) fail(`Native code without a valid signature:\n${unsigned.join('\n')}`);
  process.stdout.write(`Verified the signatures of ${checked} native ${hostArch} binaries\n`);
}

/**
 * Proves the pruned pack can still do the app work the service asks of it: the bundled Node
 * imports the pack's own `@atd/app-kit`, whose toolchain must resolve entirely inside the pack,
 * typechecks and builds the app template in the same sandboxes the service uses, and passes the
 * backend sandbox self-check.
 */
function checkAppToolchain(nodePath, packRoot) {
  const entry = path.join(packRoot, 'node_modules', '@atd', 'app-kit', 'dist', 'node', 'index.js');
  const script = `
    import fs from 'node:fs';
    import os from 'node:os';
    import path from 'node:path';
    const kit = await import(${JSON.stringify(pathToFileURL(entry).href)});
    const pack = ${JSON.stringify(packRoot)};
    const toolchain = kit.loadToolchain();
    const paths = [toolchain.root, toolchain.tsc, ...toolchain.readRoots,
      ...toolchain.cssAliases.map((alias) => alias.file), ...Object.values(toolchain.typePackages)];
    const outside = paths.filter((file) => file !== pack && !file.startsWith(pack + path.sep));
    if (outside.length > 0) throw new Error('Toolchain paths outside the pack: ' + outside);
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'atd-pack-check-'));
    try {
      const staged = await kit.prepareStaging(path.join(toolchain.root, 'template'), path.join(work, 'staging'));
      if (!staged.ok) throw new Error('Staging failed: ' + JSON.stringify(staged.errors));
      const [typecheck, build] = await Promise.all([
        kit.typecheckApp({ app: staged.app, workDir: path.join(work, 'typecheck') }),
        kit.buildApp({ app: staged.app, outDir: path.join(work, 'out'), workDir: path.join(work, 'build') }),
      ]);
      if (!typecheck.ok) throw new Error('Typecheck failed: ' + JSON.stringify(typecheck).slice(0, 4000));
      if (!build.ok) throw new Error('Build failed: ' + JSON.stringify(build).slice(0, 4000));
      const sandbox = await kit.selfCheckSandbox({ workDir: path.join(work, 'self-check') });
      if (!sandbox.ok) throw new Error('Sandbox self-check failed: ' + sandbox.reason);
      console.log('App toolchain check: typecheck ' + typecheck.durationMs + ' ms, build ' + build.durationMs + ' ms, sandbox ok');
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  `;
  const run = spawnSync(nodePath, ['--input-type=module', '--eval', script], {
    cwd: packRoot,
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' },
    stdio: 'inherit',
    timeout: 300_000,
  });
  if (run.status !== 0) fail('The pruned pack failed the app toolchain check.');
}

for (const file of [cli, contracts, client]) {
  try {
    await access(file);
  } catch {
    process.stderr.write(`Missing built file ${file}. Run \`pnpm build\` before packaging.\n`);
    process.exit(1);
  }
}

const stagedNode = await stageNode();
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
await pruneStore(stagedModules);
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
await checkNativeSignatures([packDir, nodeStage]);
checkAppToolchain(stagedNode, await realpath(packDir));
const buildInfo = { version: 1, buildId: randomUUID() };
await writeFile(path.join(packDir, 'build-info.json'), `${JSON.stringify(buildInfo, null, 2)}\n`);
process.stdout.write(
  `Staged service pack at ${packDir}\nPi: ${resolved}\nBuild: ${buildInfo.buildId}\n`,
);
