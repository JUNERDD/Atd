// Packages a built Atd.app into the installer dmg: draws the background for the app's version and
// architecture, then runs build.py with settings.py, which lays the window out from layout.json.
//
//   node apps/macos/dmg/package.mjs <path/to/Atd.app> <out-dir>
//
// Writes <out-dir>/Atd-<CFBundleShortVersionString>-<arch>.dmg and prints its path last. The
// architecture comes from the app's main executable, never from the machine that packages it, so
// the file name and the readout cannot disagree with the app inside: arm64 stays arm64 and x86_64
// is named x64, the names the release assets and update feeds use.
//
// DMG_PYTHON names the Python interpreter (default: `python3` on PATH); install the hash-pinned
// dmgbuild from requirements.txt into its virtual environment, as the release workflow does.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeBackground } from './background.mjs';

/** Mach-O architecture names mapped to the names in release asset and feed file names. */
const ARCH_NAMES = { arm64: 'arm64', x86_64: 'x64' };

const [app, outDir] = process.argv.slice(2).map((path) => resolve(path));
if (!app || !outDir || basename(app) !== 'Atd.app') {
  console.error('usage: node apps/macos/dmg/package.mjs <path/to/Atd.app> <out-dir>');
  process.exit(1);
}

const plist = (key) =>
  execFileSync('plutil', ['-extract', key, 'raw', join(app, 'Contents/Info.plist')], {
    encoding: 'utf8',
  }).trim();

/** The single architecture of the app's main executable, as a release name. */
function appArch() {
  const executable = join(app, 'Contents/MacOS', plist('CFBundleExecutable'));
  const archs = execFileSync('lipo', ['-archs', executable], { encoding: 'utf8' })
    .trim()
    .split(/\s+/);
  const name = archs.length === 1 ? ARCH_NAMES[archs[0]] : undefined;
  if (!name) {
    console.error(
      `${executable} must hold exactly one of arm64 or x86_64, not "${archs.join(' ')}".`,
    );
    process.exit(1);
  }
  return name;
}

const version = plist('CFBundleShortVersionString');
const arch = appArch();
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `Atd-${version}-${arch}.dmg`);

// dmgbuild pairs background.png with every background@Nx.png beside it, so the pair gets a
// directory of its own.
const backgroundDir = mkdtempSync(join(tmpdir(), 'atd-dmg-'));
try {
  writeBackground(backgroundDir, version, arch);
  const here = fileURLToPath(new URL('.', import.meta.url));
  execFileSync(
    process.env.DMG_PYTHON ?? 'python3',
    [
      join(here, 'build.py'),
      app,
      join(backgroundDir, 'background.png'),
      join(here, 'layout.json'),
      // Keep releases distinct when multiple installers are mounted at once.
      `Atd ${version}`,
      out,
    ],
    // dmgbuild's progress goes to stderr so stdout carries only the dmg path.
    { stdio: ['ignore', process.stderr, 'inherit'] },
  );
} finally {
  rmSync(backgroundDir, { recursive: true, force: true });
}
console.log(out);
