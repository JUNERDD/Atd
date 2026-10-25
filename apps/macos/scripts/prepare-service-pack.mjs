#!/usr/bin/env node
/**
 * Stages what the Release app embeds beside the renderer (project.yml's "Embed renderer and
 * service" phase), for this Mac's native architecture, the one scripts/build.mjs builds the app
 * for:
 *
 * 1. the official Node.js that runs the packaged service, pinned by `.node-version`
 *    (service-pack/node-release.mjs, staged in tmp/t7-node);
 * 2. this build's add-on archives and the lock that pins them (addons/pack.mjs, release mode, in
 *    tmp/addons-release), whose URLs name the GitHub release `v<marketing version>`: the
 *    `--marketing-version` argument, by default apps/macos/package.json's version. The release
 *    workflow uploads the archives with the dmgs;
 * 3. a production deploy of the built service (service-pack/deploy.mjs, tmp/t7-agent-service-pack),
 *    which must leave the workspace lockfile and install state untouched;
 * 4. the virtual store cut down to what the service and the generated-app toolchain reach, without
 *    the dependencies only the add-ons use (service-pack/prune-store.mjs,
 *    verify-app/pack-layout.mjs: ADDON_ONLY_LINKS), then native code for other platforms removed
 *    (service-pack/prune-arch.mjs), the browser worker's build output and the dependencies' source
 *    maps dropped;
 * 5. an ad hoc signature for each native binary that arrived without one
 *    (service-pack/sign-native.mjs), and the add-on lock at the pack's root;
 * 6. `verify-app.mjs pack` on the result (required modules, the add-on lock and the absence of
 *    add-on parts, the Mach-O rules, real loads with the staged Node, esbuild and the offline app
 *    toolchain), then `verify-app.mjs addons` on the archives the lock pins. Any failure fails the
 *    pack.
 *
 * Every run writes a fresh build-info.json into the pack, identifying this packaged service build.
 *
 * pnpm installs native packages for the architecture of the Node running it, so this script must
 * run under a native Node too (not under Rosetta on Apple silicon).
 */
import { access, copyFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { packAddons, packageVersion, releaseUrlsFor } from './addons/pack.mjs';
import { nativeHostArch } from './arch.mjs';
import { deployService } from './service-pack/deploy.mjs';
import { stageNode } from './service-pack/node-release.mjs';
import { pruneForArch } from './service-pack/prune-arch.mjs';
import { pruneStore } from './service-pack/prune-store.mjs';
import { signUnsigned } from './service-pack/sign-native.mjs';
import {
  ADDON_ONLY_LINKS,
  COMPUTER_WORKER_DIR,
  PACK_ADDONS_LOCK,
} from './verify-app/pack-layout.mjs';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, '../../..');
const packDir = path.join(repoRoot, 'tmp', 't7-agent-service-pack');
const nodeStage = path.join(repoRoot, 'tmp', 't7-node');
const addonsDir = path.join(repoRoot, 'tmp', 'addons-release');
const builtFiles = [
  path.join(repoRoot, 'apps', 'agent-service', 'dist', 'cli.js'),
  path.join(repoRoot, 'apps', 'agent-service', 'dist', 'computer', 'worker', 'server.js'),
  path.join(repoRoot, 'packages', 'agent-contracts', 'dist', 'index.js'),
  path.join(repoRoot, 'packages', 'agent-client', 'dist', 'index.js'),
];

/** The pack's target: this Mac's native architecture, which the running Node must match. */
function targetArch() {
  const arch = nativeHostArch();
  if (process.arch !== arch)
    throw new Error(
      `This Mac is ${arch} but Node runs as ${process.arch}; run the pack with a native ${arch} Node.`,
    );
  return arch;
}

/**
 * The packaged service runs without --enable-source-maps, so the dependencies' source maps are
 * never read; dropping them removes about a sixth of the files the app embeds, signs and
 * compresses. Unlinking leaves the pnpm store copies alone. Type declarations, TypeScript sources
 * and docs stay: Pi and its extensions can read them at runtime.
 */
async function removeSourceMaps(modules) {
  let removed = 0;
  for (const entry of await readdir(modules, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.map')) continue;
    await rm(path.join(entry.parentPath, entry.name));
    removed += 1;
  }
  process.stdout.write(`Removed ${removed} dependency source maps\n`);
}

/** Runs verify-app.mjs in `mode` with `options`; any failure fails the pack. */
function verify(mode, options) {
  const args = Object.entries(options).flatMap(([name, value]) => [`--${name}`, value]);
  const run = spawnSync(
    process.execPath,
    [path.join(scriptsDir, 'verify-app.mjs'), mode, ...args],
    {
      stdio: 'inherit',
    },
  );
  if (run.status !== 0) throw new Error(`The service pack failed verify-app ${mode}.`);
}

async function main() {
  const { values } = parseArgs({ options: { 'marketing-version': { type: 'string' } } });
  const appVersion = values['marketing-version'] ?? (await packageVersion());
  const arch = targetArch();
  for (const file of builtFiles) {
    await access(file).catch(() => {
      throw new Error(`Missing built file ${file}. Run \`pnpm build\` before packaging.`);
    });
  }
  const node = await stageNode({ repoRoot, arch, stageDir: nodeStage });
  const addons = await packAddons({ arch, outDir: addonsDir, urls: releaseUrlsFor(appVersion) });
  await deployService({ repoRoot, packDir });
  const modules = path.join(packDir, 'node_modules');
  await access(path.join(packDir, 'dist', 'cli.js')).catch(() => {
    throw new Error('pnpm deploy did not produce dist/cli.js.');
  });

  await pruneStore(modules, ADDON_ONLY_LINKS);
  await pruneForArch(packDir, arch);
  await rm(path.join(packDir, COMPUTER_WORKER_DIR), { recursive: true });
  await removeSourceMaps(modules);
  await signUnsigned([packDir], arch);
  const lock = path.join(packDir, PACK_ADDONS_LOCK);
  await copyFile(addons.lockFile, lock);

  verify('pack', { node, pack: packDir, arch });
  verify('addons', { node, lock, dir: addonsDir, arch });

  const buildInfo = { version: 1, buildId: randomUUID() };
  await writeFile(path.join(packDir, 'build-info.json'), `${JSON.stringify(buildInfo, null, 2)}\n`);
  const pi = await realpath(
    path.join(modules, '@earendil-works', 'pi-coding-agent', 'dist', 'index.js'),
  );
  process.stdout.write(
    `Staged service pack at ${packDir}\nPi: ${pi}\nBuild: ${buildInfo.buildId}\n`,
  );
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
