/** Public values already shipped to 0.10.x users. The 0.11 signing migration must retain them. */
import { run } from './config.mjs';
import path from 'node:path';

export const legacyUpdateKey = 'ZkMCOa3sWdgMqszOe6hWN78I1eh77SzbSaghs2iy6lU=';

export function checkUpgradeCompatibility(app) {
  const info = JSON.parse(
    run('plutil', ['-convert', 'json', '-o', '-', path.join(app, 'Contents/Info.plist')]),
  );
  const arch = run('lipo', [
    '-archs',
    path.join(app, 'Contents/MacOS', info.CFBundleExecutable),
  ]).trim();
  if (!['arm64', 'x86_64'].includes(arch)) throw new Error('Unexpected release architecture.');
  const expected = {
    CFBundleIdentifier: 'com.junerdd.ai',
    AtdHostBundleIdentifier: 'com.junerdd.ai',
    AtdURLScheme: 'atd',
    SUPublicEDKey: legacyUpdateKey,
    SUFeedURL: `https://downloads.atd.best/${arch === 'arm64' ? 'appcast.xml' : 'appcast-x64.xml'}`,
    AtdArm64FeedURL: 'https://downloads.atd.best/appcast.xml',
    LSMinimumSystemVersion: '15.0',
  };
  for (const [key, value] of Object.entries(expected))
    if (info[key] !== value)
      throw new Error(`${key} changed; this breaks the existing-user upgrade contract.`);
  if (info.CFBundleVersion.includes('-'))
    throw new Error('Sparkle build versions must not contain a dash.');
  console.log('Existing-user upgrade identifiers, feeds and EdDSA trust are preserved.');
}
