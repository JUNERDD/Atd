#!/usr/bin/env node
/** Notarize the app before packaging, then sign, notarize and staple the final DMG. */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { configureSigning, run } from './config.mjs';
import { notarize } from './notarize.mjs';
import { verifyDeveloperId, verifyReleaseEntitlements } from './sign-app.mjs';
import { checkUpgradeCompatibility } from './upgrade-compat.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { values } = parseArgs({
  options: {
    app: { type: 'string' },
    out: { type: 'string' },
    'app-only': { type: 'boolean' },
    'skip-notarize': { type: 'boolean' },
  },
});
const skipNotarize = Boolean(values['skip-notarize']);
const app = path.resolve(
  values.app || path.join(root, 'DerivedData/Build/Products/Release/Atd.app'),
);
const out = path.resolve(values.out || path.join(root, '../../dist'));
const config = configureSigning('Release');
if (!config)
  throw new Error(
    'Distribution requires Developer ID signing; ad hoc is only for packaging rehearsals.',
  );
const metadata = verifyDeveloperId(app, config);
verifyReleaseEntitlements(app);
const cdHash = /^CDHash=([a-f0-9]+)$/m.exec(metadata)?.[1];
if (!cdHash) throw new Error('Cannot identify the signed app for notarization resumption.');
checkUpgradeCompatibility(app);
mkdirSync(out, { recursive: true });
const version = run('plutil', [
  '-extract',
  'CFBundleShortVersionString',
  'raw',
  path.join(app, 'Contents/Info.plist'),
]).trim();
const arch = run('lipo', ['-archs', path.join(app, 'Contents/MacOS/Atd')]).trim();
// A signature-specific directory keeps submitted bytes intact across interrupted runs.
// Stapling does not change CDHash, so a completed stage remains reusable.
const submissions = path.join(root, 'DerivedData/notarization', cdHash);
if (!skipNotarize) {
  mkdirSync(submissions, { recursive: true });
  const archive = path.join(submissions, `Atd-${version}-${arch}.zip`);
  if (!existsSync(archive)) {
    const partial = `${archive}.partial`;
    rmSync(partial, { force: true });
    run('ditto', ['-c', '-k', '--keepParent', app, partial]);
    renameSync(partial, archive);
  }
  await notarize(archive, app);
  run('spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
}
if (!values['app-only']) {
  const dmgDir = skipNotarize ? out : submissions;
  const dmg = path.join(dmgDir, `Atd-${version}-${arch === 'x86_64' ? 'x64' : arch}.dmg`);
  if (skipNotarize || !existsSync(`${dmg}.notary.json`)) {
    // Keep packaging's timeout separate from Apple's longer notarization queue.
    const packaged = run(process.execPath, [path.join(root, 'dmg/package.mjs'), app, dmgDir], {
      timeout: 10 * 60 * 1000,
    });
    if (path.resolve(packaged.trim().split('\n').at(-1)) !== dmg)
      throw new Error('The packager returned an unexpected DMG path.');
    run('codesign', [
      '--force',
      '--sign',
      config.identity,
      '--timestamp',
      ...(config.keychain ? ['--keychain', config.keychain] : []),
      dmg,
    ]);
  }
  verifyDeveloperId(dmg, config, { runtime: false });
  if (!skipNotarize) {
    await notarize(dmg);
    run('spctl', [
      '--assess',
      '--type',
      'open',
      '--context',
      'context:primary-signature',
      '--verbose=2',
      dmg,
    ]);
  }
  const output = path.join(out, path.basename(dmg));
  if (output !== dmg) copyFileSync(dmg, output);
  const digest = createHash('sha256').update(readFileSync(output)).digest('hex');
  writeFileSync(`${output}.sha256`, `${digest}  ${path.basename(output)}\n`);
  console.log(`Distribution ready: ${output}`);
}
