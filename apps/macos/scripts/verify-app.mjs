#!/usr/bin/env node
/**
 * Verifies what the Release app ships for one architecture, in three modes:
 *
 *   node verify-app.mjs pack --node <node binary> --pack <service pack root> --arch <arm64|x64>
 *   node verify-app.mjs app --app <Atd.app> --feed-url <url> --arm64-feed-url <url>
 *     --public-ed-key <key>
 *   node verify-app.mjs addons --node <node binary> --lock <addons.lock.json>
 *     --dir <archive directory> --arch <arm64|x64>
 *
 * `pack` runs while packaging (prepare-service-pack.mjs): the service pack's required modules,
 * its add-on lock and the absence of what the add-ons ship, the Mach-O rules for its native code
 * and the Node executable, real loads of the native addons with that Node, esbuild, and the
 * offline app toolchain with its sandbox and npm self-checks.
 * `app` runs on a built app: its Info.plist feeds and Sparkle key, the target architecture taken
 * from the main executable, the widget extension, Sparkle, the computer-use driver helper (thinned
 * to that architecture, and started once with its input closed), and every `pack` check run with
 * the app's own Node, with the Mach-O rules over the whole bundle and every binary's minimum macOS
 * at or below the app's `LSMinimumSystemVersion`. `addons` checks the add-on archives a lock pins
 * (the pack's or the app's own `addons.lock.json`) as found in a directory: digests, format and
 * manifest, then the unpacked browser worker's files and a run of it by the given Node
 * (verify-app/addon-checks.mjs). Any Node may run this script; the checks spawn the Node being
 * verified.
 *
 * Uses Node built-ins and the Command Line Tools (`lipo`, `codesign`, `vtool`, `plutil`) only, so
 * it runs from a checkout without node_modules. Exits 0 when everything holds; otherwise prints
 * the failing file and rule and exits 1.
 */
import path from 'node:path';
import { parseArgs } from 'node:util';
import { MACHO_ARCHS } from './arch.mjs';
import { verifyAddons } from './verify-app/addon-checks.mjs';
import { verifyApp } from './verify-app/app-checks.mjs';
import { verifyPack } from './verify-app/pack-checks.mjs';

const MODES = {
  pack: ['node', 'pack', 'arch'],
  app: ['app', 'feed-url', 'arm64-feed-url', 'public-ed-key'],
  addons: ['node', 'lock', 'dir', 'arch'],
};

function readOptions() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: Object.fromEntries(
      [...new Set(Object.values(MODES).flat())].map((name) => [name, { type: 'string' }]),
    ),
    strict: true,
  });
  const [mode, ...extra] = positionals;
  if (!(mode in MODES) || extra.length > 0)
    throw new Error(`the mode must be ${Object.keys(MODES).join(', ')}.`);
  const missing = MODES[mode].filter((name) => !values[name]);
  const unused = Object.keys(values).filter((name) => !MODES[mode].includes(name));
  if (missing.length > 0) throw new Error(`${mode} needs --${missing.join(', --')}.`);
  if (unused.length > 0) throw new Error(`${mode} does not take --${unused.join(', --')}.`);
  if ((mode === 'pack' || mode === 'addons') && !(values.arch in MACHO_ARCHS))
    throw new Error(`--arch must be arm64 or x64, not ${values.arch}.`);
  return { mode, values };
}

try {
  const { mode, values } = readOptions();
  // Absolute, because the checks spawn the verified Node from other working directories.
  if (mode === 'pack')
    await verifyPack({
      node: path.resolve(values.node),
      pack: path.resolve(values.pack),
      arch: values.arch,
    });
  else if (mode === 'addons')
    await verifyAddons({
      node: path.resolve(values.node),
      lock: path.resolve(values.lock),
      dir: path.resolve(values.dir),
      arch: values.arch,
    });
  else
    await verifyApp({
      app: path.resolve(values.app),
      feedUrl: values['feed-url'],
      arm64FeedUrl: values['arm64-feed-url'],
      publicEdKey: values['public-ed-key'],
    });
  process.stdout.write(`verify-app ${mode}: all checks passed\n`);
} catch (error) {
  process.stderr.write(`verify-app: ${error.message}\n`);
  process.exit(1);
}
