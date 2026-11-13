/** Sign contained code before its containers. Never use --deep to sign an app. */
import { spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { copyFile, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { findMachO, sliceArchs } from '../verify-app/macho.mjs';
import { run, validateIdentity, signingConfig } from './config.mjs';

const bundlePattern = /\.(app|appex|framework|xpc|bundle)$/;
const depth = (file) => file.split(path.sep).length;

async function signingTargets(app) {
  const targets = (await findMachO([app]))
    .filter(({ file }) => sliceArchs(file))
    .map(({ file }) => file);
  for (const entry of await readdir(app, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory() && bundlePattern.test(entry.name)) {
      const file = path.join(entry.parentPath, entry.name);
      // Resource-only .bundles do not have a code signature.
      if (targets.some((binary) => binary.startsWith(`${file}${path.sep}`))) targets.push(file);
    }
  }
  return [...new Set([...targets, app])].sort((a, b) => depth(b) - depth(a) || a.localeCompare(b));
}

function readEntitlements(file) {
  // Modern codesign defaults to a human-readable dictionary; request XML explicitly.
  const xml = run('codesign', ['-d', '--entitlements', '-', '--xml', file]).trim();
  if (!xml) return {};
  if (!xml.startsWith('<?xml')) throw new Error(`Unrecognized entitlements output: ${file}`);
  return JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', '-'], { input: xml }));
}

function entitlements(file, app) {
  // Existing sandbox/IPC entitlements on Sparkle and the app extensions must survive re-signing.
  const values = readEntitlements(file);
  delete values['com.apple.security.get-task-allow'];
  if (file === path.join(app, 'Contents/Resources/node/bin/node')) {
    for (const key of Object.keys(values)) delete values[key];
    values['com.apple.security.cs.allow-jit'] = true;
    // User-installed extensions/apps may load native addons signed by other developers.
    values['com.apple.security.cs.disable-library-validation'] = true;
  }
  if (file === app || file === path.join(app, 'Contents/MacOS/Atd'))
    values['com.apple.security.device.audio-input'] = true;
  return values;
}

export function verifyDeveloperId(file, config = signingConfig(), { runtime = true } = {}) {
  run('codesign', ['--verify', '--deep', '--strict', file]);
  const result = spawnSync('codesign', ['-d', '--verbose=4', file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Cannot inspect signature: ${file}`);
  const metadata = result.stderr;
  if (
    !metadata.includes(`TeamIdentifier=${config.teamId}`) ||
    !metadata.includes('Authority=Developer ID Application:') ||
    !/^Timestamp=/m.test(metadata) ||
    (runtime && !/flags=.*\(.*runtime/.test(metadata))
  )
    throw new Error(`Developer ID signature, timestamp or hardened runtime missing: ${file}`);
  return metadata;
}

/** Extension sandbox contracts must survive packaging; a valid code signature alone is insufficient. */
export function verifyReleaseEntitlements(app) {
  for (const extension of ['AtdFinderSync.appex', 'AtdWidgets.appex']) {
    const values = readEntitlements(path.join(app, 'Contents/PlugIns', extension));
    if (
      values['com.apple.security.app-sandbox'] !== true ||
      values['com.apple.security.get-task-allow']
    )
      throw new Error(`Release sandbox entitlements are invalid: ${extension}`);
    if (
      extension === 'AtdWidgets.appex' &&
      !isDeepStrictEqual(
        values['com.apple.security.temporary-exception.files.home-relative-path.read-only'],
        ['/Library/Application Support/com.junerdd.ai/widgets/'],
      )
    )
      throw new Error('The widget cannot read the existing release widget data directory.');
  }
}

export async function signApp(app, config = signingConfig()) {
  config = validateIdentity(config);
  const temporary = await mkdtemp(path.join(tmpdir(), 'atd-sign-'));
  try {
    const targets = await signingTargets(app);
    const expectedEntitlements = new Map();
    console.log(`Signing ${targets.length} code objects with Developer ID.`);
    for (const [index, file] of targets.entries()) {
      const values = entitlements(file, app);
      expectedEntitlements.set(file, values);
      const plist = path.join(temporary, `${index}.plist`);
      await writeFile(plist, JSON.stringify(values));
      run('plutil', ['-convert', 'xml1', plist]);
      const args = [
        '--force',
        '--sign',
        config.identity,
        '--timestamp',
        '--options',
        'runtime',
        ...(config.keychain ? ['--keychain', config.keychain] : []),
        ...(Object.keys(values).length ? ['--entitlements', plist] : []),
      ];
      // Avoid mutating a pnpm/Xcode hard link outside the built app.
      if (!bundlePattern.test(file)) {
        const copy = `${file}.atd-signing`;
        await copyFile(file, copy);
        await rename(copy, file);
      }
      run('codesign', [...args, file]);
    }
    verifyDeveloperId(app, config);
    verifyReleaseEntitlements(app);
    for (const [file, expected] of expectedEntitlements) {
      if (!isDeepStrictEqual(readEntitlements(file), expected))
        throw new Error(`Entitlements changed unexpectedly while signing: ${file}`);
    }
    // Verification must include binaries stored under Resources, which --deep can miss.
    for (const { file } of await findMachO([app])) {
      if (sliceArchs(file)) run('codesign', ['--verify', '--strict', file]);
    }
    console.log(`Signed ${targets.length} code objects with Developer ID and secure timestamps.`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
