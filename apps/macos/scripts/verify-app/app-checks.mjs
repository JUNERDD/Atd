/**
 * The built app's checks on top of its service pack's: the Info.plist values each architecture's
 * build must carry, the main executable that decides the target architecture, the parts every
 * Release build embeds (widget extension, Sparkle, the computer-use driver helper, renderer,
 * service pack with its add-on lock, and Node) and the one it never does again (the retired Cua
 * driver), the helper's own checks (helper-check.mjs), the Mach-O rules across the whole bundle
 * with the app's own `LSMinimumSystemVersion`, and the bundle's signature, checked last so it
 * also proves the other checks left the bundle untouched. The add-on archives the lock pins are
 * checked with `verify-app.mjs addons`.
 */
import { access, lstat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { nodeArchOf } from '../arch.mjs';
import { DRIVER_HELPER, verifyDriverHelper } from './helper-check.mjs';
import { sliceArchs } from './macho.mjs';
import { PACK_ADDONS_LOCK } from './pack-layout.mjs';
import { verifyPack } from './pack-checks.mjs';

function readPlist(file) {
  const run = spawnSync('plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`Cannot read ${file}: ${run.stderr.trim()}`);
  return JSON.parse(run.stdout);
}

function checkInfo(file, info, expected) {
  const wrong = Object.entries(expected)
    .filter(([key, value]) => info[key] !== value)
    .map(
      ([key, value]) => `${key} is ${JSON.stringify(info[key])}, expected ${JSON.stringify(value)}`,
    );
  if (typeof info.LSMinimumSystemVersion !== 'string')
    wrong.push('LSMinimumSystemVersion is missing');
  if (wrong.length > 0) throw new Error(`${file}:\n${wrong.join('\n')}`);
}

/** The Node name of the single architecture the main executable is built for. */
function targetArch(executable) {
  const archs = sliceArchs(executable);
  const arch = archs?.length === 1 ? nodeArchOf(archs[0]) : undefined;
  if (arch === undefined)
    throw new Error(
      `${executable} must hold exactly one of arm64 or x86_64, not ${archs?.join(', ') ?? 'unreadable'}.`,
    );
  return arch;
}

/** Verifies the app at `app` against the Info.plist values its architecture's build must carry. */
export async function verifyApp({ app, feedUrl, arm64FeedUrl, publicEdKey }) {
  const contents = path.join(app, 'Contents');
  const infoFile = path.join(contents, 'Info.plist');
  const info = readPlist(infoFile);
  checkInfo(infoFile, info, {
    SUFeedURL: feedUrl,
    AtdArm64FeedURL: arm64FeedUrl,
    SUPublicEDKey: publicEdKey,
  });
  const arch = targetArch(path.join(contents, 'MacOS', info.CFBundleExecutable));
  process.stdout.write(
    `${app}: ${arch}, LSMinimumSystemVersion ${info.LSMinimumSystemVersion}, Info.plist feeds and key as expected\n`,
  );

  const resources = path.join(contents, 'Resources');
  const node = path.join(resources, 'node', 'bin', 'node');
  const pack = path.join(resources, 'agent-service');
  const helper = path.join(contents, 'MacOS', DRIVER_HELPER);
  const embedded = [
    path.join(contents, 'PlugIns', 'AtdWidgets.appex', 'Contents', 'MacOS', 'AtdWidgets'),
    path.join(contents, 'Frameworks', 'Sparkle.framework', 'Sparkle'),
    helper,
    path.join(resources, 'renderer', 'index.html'),
    path.join(pack, 'build-info.json'),
    path.join(pack, PACK_ADDONS_LOCK),
    node,
  ];
  const missing = [];
  for (const file of embedded) await access(file).catch(() => missing.push(file));
  if (missing.length > 0) throw new Error(`The app lacks:\n${missing.join('\n')}`);

  const retired = path.join(resources, 'cua-driver');
  if (await lstat(retired).catch(() => null))
    throw new Error(`${retired} must not ship; the Cua driver is retired.`);
  await verifyDriverHelper({ helper, arch, maxMinos: info.LSMinimumSystemVersion });
  await verifyPack({ node, pack, arch, maxMinos: info.LSMinimumSystemVersion, machORoots: [app] });

  const seal = spawnSync('codesign', ['--verify', '--strict', app], { encoding: 'utf8' });
  if (seal.status !== 0) throw new Error(`${app} fails its signature check: ${seal.stderr.trim()}`);
  process.stdout.write(`${app}: bundle signature valid\n`);
}
