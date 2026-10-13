/**
 * The service pack's checks: the modules the service cannot work without are present for the
 * target architecture, every native binary meets the Mach-O rules, the Node that runs the pack
 * actually loads the native addons, esbuild runs, and the generated-app toolchain still works
 * offline from inside the pack. Each check throws with the file and rule it found broken.
 */
import { access, readFile, realpath } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { MACHO_ARCHS } from '../arch.mjs';
import { checkMachO, findMachO } from './macho.mjs';
import { ESBUILD, PI_TUI, fileIndexAddon, piTuiAddon, storeCopies } from './pack-layout.mjs';
import { checkAppToolchain } from './toolchain-check.mjs';

/** What the checks run with: no inherited PATH or Node options. */
const CHILD_ENV = { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' };

const exists = (file) =>
  access(file).then(
    () => true,
    () => false,
  );

/** Returns the pi-tui addons and esbuild copies to exercise; throws listing what is missing. */
async function checkRequiredModules(packRoot, arch) {
  const modules = path.join(packRoot, 'node_modules');
  const required = [
    path.join(packRoot, 'dist', 'cli.js'),
    path.join(modules, '@earendil-works', 'pi-coding-agent', 'dist', 'index.js'),
    path.join(modules, '@atd', 'app-kit', 'dist', 'node', 'index.js'),
    path.join(modules, '@atd', 'file-index', fileIndexAddon(arch)),
    path.join(modules, '@napi-rs', 'keyring', 'package.json'),
  ];
  const keyrings = await storeCopies(packRoot, `@napi-rs/keyring-darwin-${arch}`);
  const piTuiAddons = (await storeCopies(packRoot, PI_TUI)).map((dir) =>
    path.join(dir, piTuiAddon(arch)),
  );
  const esbuilds = await storeCopies(packRoot, ESBUILD);
  required.push(...piTuiAddons);
  for (const dir of esbuilds)
    required.push(path.join(path.dirname(dir), '@esbuild', `darwin-${arch}`, 'bin', 'esbuild'));

  const missing = [];
  for (const file of required) if (!(await exists(file))) missing.push(file);
  if (keyrings.length === 0) missing.push(`@napi-rs/keyring-darwin-${arch} in the virtual store`);
  if (piTuiAddons.length === 0) missing.push(`${PI_TUI} in the virtual store`);
  if (esbuilds.length === 0) missing.push(`${ESBUILD} in the virtual store`);
  if (missing.length > 0)
    throw new Error(`The pack lacks required modules for ${arch}:\n${missing.join('\n')}`);
  const pi = await realpath(required[1]);
  if (!pi.startsWith(`${packRoot}${path.sep}`))
    throw new Error(`Pi resolves outside the pack (${pi}).`);
  return { piTuiAddons, esbuilds };
}

function checkNodeArch(node, arch) {
  const run = spawnSync(node, ['-p', 'process.arch'], { encoding: 'utf8', env: CHILD_ENV });
  const found = run.stdout?.trim();
  if (run.status !== 0 || found !== arch)
    throw new Error(`${node} runs as ${found || 'nothing'} (exit ${run.status}), not ${arch}.`);
}

/**
 * Loads the native addons with the pack's Node: the file index and the keyring through their
 * packages, and pi-tui's clipboard addon by its exact path, because pi-tui's own loader swallows
 * a load error and leaves the clipboard silently unavailable.
 */
function checkLoads(node, packRoot, piTuiAddons) {
  const script = `
    import { createRequire } from 'node:module';
    import { pathToFileURL } from 'node:url';
    const require = createRequire(${JSON.stringify(path.join(packRoot, 'package.json'))});
    const failures = [];
    const check = async (name, load, exports) => {
      try {
        const loaded = await load();
        const missing = exports.filter((key) => typeof loaded[key] !== 'function');
        if (missing.length > 0) failures.push(name + ' exports no ' + missing.join(', '));
      } catch (error) {
        failures.push(name + ': ' + error.message);
      }
    };
    await check('@atd/file-index', () => import(pathToFileURL(require.resolve('@atd/file-index')).href), ['FileIndex']);
    await check('@napi-rs/keyring', () => require('@napi-rs/keyring'), ['Entry']);
    for (const addon of ${JSON.stringify(piTuiAddons)}) await check(addon, () => require(addon), ['getText', 'getImage']);
    console.log(JSON.stringify(failures));
  `;
  const run = spawnSync(node, ['--input-type=module', '--eval', script], {
    cwd: packRoot,
    encoding: 'utf8',
    env: CHILD_ENV,
  });
  if (run.status !== 0)
    throw new Error(
      `Loading the native addons failed (${run.signal ?? `exit ${run.status}`}): ${run.error?.message ?? run.stderr.trim()}`,
    );
  const failures = JSON.parse(run.stdout.trim().split('\n').at(-1));
  if (failures.length > 0) throw new Error(`Native addons do not load:\n${failures.join('\n')}`);
}

/** Runs each esbuild copy's launcher and platform binary, which must report its version. */
async function checkEsbuild(node, esbuilds, arch) {
  for (const dir of esbuilds) {
    const { version } = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    const binaries = [
      path.join(dir, 'bin', 'esbuild'),
      path.join(path.dirname(dir), '@esbuild', `darwin-${arch}`, 'bin', 'esbuild'),
    ];
    for (const binary of binaries) {
      // esbuild's install script replaces the JavaScript launcher with the native binary.
      const native = (await findMachO([binary])).length > 0;
      const run = native
        ? spawnSync(binary, ['--version'], { encoding: 'utf8', env: CHILD_ENV })
        : spawnSync(node, [binary, '--version'], { encoding: 'utf8', env: CHILD_ENV });
      if (run.status !== 0 || run.stdout.trim() !== version)
        throw new Error(
          `${binary} --version printed ${run.stdout?.trim() || run.stderr?.trim() || 'nothing'}, not ${version}.`,
        );
    }
  }
}

/**
 * Verifies the pack at `pack` run by `node` for `arch` (a Node architecture name). The Mach-O rules
 * cover `machORoots` (by default the pack and the Node executable); `maxMinos` is the app's
 * `LSMinimumSystemVersion`, checked only when there is an app to take it from.
 */
export async function verifyPack({ node, pack, arch, maxMinos, machORoots }) {
  const packRoot = await realpath(pack);
  const { piTuiAddons, esbuilds } = await checkRequiredModules(packRoot, arch);
  checkNodeArch(node, arch);
  const roots = machORoots ?? [packRoot, node];
  const checked = await checkMachO(roots, { machOArch: MACHO_ARCHS[arch], maxMinos });
  process.stdout.write(
    `Mach-O rules hold for ${checked} binaries (${MACHO_ARCHS[arch]}, signed${maxMinos ? `, minos <= ${maxMinos}` : ''})\n`,
  );
  checkLoads(node, packRoot, piTuiAddons);
  await checkEsbuild(node, esbuilds, arch);
  process.stdout.write(
    `Loaded the native addons and ran ${esbuilds.length} esbuild under ${arch} Node\n`,
  );
  checkAppToolchain(node, packRoot);
}
