// Packages a built Atd.app into the installer dmg: draws the background for the app's version,
// then runs dmgbuild with settings.py, which lays the window out from layout.json.
//
//   node apps/macos/dmg/package.mjs <path/to/Atd.app> <out.dmg>
//
// DMGBUILD names the dmgbuild executable (default: `dmgbuild` on PATH); install the hash-pinned
// version from requirements.txt into a virtual environment, as the release workflow does.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeBackground } from './background.mjs';

const [app, out] = process.argv.slice(2).map((path) => resolve(path));
if (!app || !out || basename(app) !== 'Atd.app') {
  console.error('usage: node apps/macos/dmg/package.mjs <path/to/Atd.app> <out.dmg>');
  process.exit(1);
}

const version = execFileSync(
  'plutil',
  ['-extract', 'CFBundleShortVersionString', 'raw', join(app, 'Contents/Info.plist')],
  { encoding: 'utf8' },
).trim();

// dmgbuild pairs background.png with every background@Nx.png beside it, so the pair gets a
// directory of its own.
const backgroundDir = mkdtempSync(join(tmpdir(), 'atd-dmg-'));
try {
  writeBackground(backgroundDir, version);
  const here = fileURLToPath(new URL('.', import.meta.url));
  execFileSync(
    process.env.DMGBUILD ?? 'dmgbuild',
    [
      '-s',
      join(here, 'settings.py'),
      '-D',
      `app=${app}`,
      '-D',
      `background=${join(backgroundDir, 'background.png')}`,
      '-D',
      `layout=${join(here, 'layout.json')}`,
      // Finder finds the background through a bookmark to /Volumes/<name>/.background.tiff. An
      // older installer still mounted under the same name takes that path, and the window then
      // shows no background, so the name carries the version.
      `Atd ${version}`,
      out,
    ],
    { stdio: 'inherit' },
  );
} finally {
  rmSync(backgroundDir, { recursive: true, force: true });
}
