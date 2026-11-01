// Publishes verified diagnostic artifacts to their own channel. Never writes release feeds,
// stable/preview manifests or mutable DMG aliases: the manifest points to immutable files.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { hashFile } from '../release-downloads/artifacts.mjs';
import { readAddons, mirrorAddon } from '../release-downloads/addons.mjs';
import { openBucket } from '../release-downloads/bucket.mjs';
import {
  freshUrl,
  holdsArtifact,
  IMMUTABLE_CACHE,
  LATEST_CACHE,
  publicUrl,
  verifyDelivery,
  verifyText,
} from '../release-downloads/delivery.mjs';

const { values } = parseArgs({
  options: {
    'source-dir': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
  },
});
assert(values['source-dir'], 'Pass --source-dir with the verified workflow artifact.');
const sourceDir = resolve(values['source-dir']);
const manifest = JSON.parse(await readFile(join(sourceDir, 'manifest.json'), 'utf8'));
const {
  marketingVersion: version,
  buildVersion,
  commit: revision,
  diagnosticProfile: profile,
} = manifest;
assert(
  /^\d+\.\d+\.\d+-[A-Za-z][0-9A-Za-z.-]*$/.test(version),
  'Use a unique diagnostic prerelease version.',
);
assert(
  /^\d+\.\d+\.\d+[A-Za-z][0-9A-Za-z.]*$/.test(buildVersion),
  'Use a dash-free diagnostic build version.',
);
assert(/^[a-f0-9]{40}$/.test(revision), 'Missing source commit.');
assert(['runtime', 'focus'].includes(profile), 'Missing diagnostic profile.');
assert(
  Array.isArray(manifest.artifacts) &&
    manifest.artifacts.length >= 1 &&
    manifest.artifacts.length <= 2 &&
    manifest.artifacts.every((entry) => ['arm64', 'x64'].includes(entry.arch)),
  'One or both verified architectures are required.',
);
const artifacts = [];
for (const arch of ['arm64', 'x64']) {
  const entries = manifest.artifacts.filter((entry) => entry.arch === arch);
  if (entries.length === 0) continue;
  assert(entries.length === 1, `Expected exactly one ${arch} artifact.`);
  const entry = entries[0];
  const name = `Atd-${version}-${arch}.dmg`;
  assert.equal(entry.dmg, name);
  assert(/^[a-f0-9]{64}$/.test(entry.sha256), 'Missing SHA-256.');
  assert(
    Number.isSafeInteger(entry.size) && entry.size > 0 && entry.size <= 512 * 1024 ** 2,
    'Invalid DMG size.',
  );
  const file = join(sourceDir, name);
  assert.equal((await stat(file)).size, entry.size, `${arch} size mismatch.`);
  assert.equal(await hashFile(file), entry.sha256, `${arch} digest mismatch.`);
  // Add-ons are required for this generation of the app, even when their bytes are already mirrored.
  assert((await stat(join(sourceDir, `addons-${arch}.lock.json`))).isFile());
  artifacts.push({ arch, name, file, size: entry.size, sha256: entry.sha256 });
}
const addons = await readAddons({ artifacts }, { sourceDir, directory: sourceDir, prefix: '' });
const baseUrl = 'https://downloads.atd.best';
const keyFor = (artifact) => `debug/builds/${revision}/${version}/${artifact.name}`;
if (values['dry-run']) {
  console.log(
    JSON.stringify(
      {
        version,
        buildVersion,
        revision,
        profile,
        files: artifacts.map(keyFor),
        addons: addons.map((addon) => addon.key),
      },
      null,
      2,
    ),
  );
} else {
  assert.equal(process.env.GITHUB_REF, 'refs/heads/debug', 'Publish only from debug.');
  assert.equal(
    process.env.GITHUB_EVENT_NAME,
    'workflow_dispatch',
    'Publish only a manual diagnostic build.',
  );
  assert.equal(
    process.env.GITHUB_SHA,
    revision,
    'Artifact does not belong to this workflow commit.',
  );
  const directory = await mkdtemp(join(tmpdir(), 'atd-debug-downloads-'));
  try {
    const bucket = openBucket({ bucket: 'atd-releases', prefix: 'debug/', directory });
    const nonce = `${revision}-${Date.now()}`;
    for (const artifact of artifacts) {
      const key = keyFor(artifact);
      if (!(await holdsArtifact(freshUrl(baseUrl, key, nonce), artifact))) {
        bucket.uploadImmutable(artifact, key, version);
      }
      await verifyDelivery({
        url: publicUrl(baseUrl, key),
        artifact,
        cacheControl: IMMUTABLE_CACHE,
        full: true,
      });
    }
    // These existing content-addressed dependencies are shared with production; never replaced.
    for (const addon of addons) await mirrorAddon({ bucket, baseUrl, addon, nonce });
    const report = {
      schemaVersion: 1,
      channel: 'debug',
      version,
      buildVersion,
      revision,
      profile,
      publishedAt: new Date().toISOString(),
      architectures: Object.fromEntries(
        artifacts.map((artifact) => [
          artifact.arch,
          {
            url: publicUrl(baseUrl, keyFor(artifact)).href,
            sha256: artifact.sha256,
            bytes: artifact.size,
            minMacOS: '15',
          },
        ]),
      ),
    };
    const body = `${JSON.stringify(report, null, 2)}\n`;
    // The one mutable pointer moves only after every installer and dependency passes read-back.
    await bucket.putText('debug/manifest.json', body, 'application/json');
    await verifyText({
      url: freshUrl(baseUrl, 'debug/manifest.json', nonce),
      expected: body,
      cacheControl: LATEST_CACHE,
    });
    console.log(`Published diagnostic downloads: ${version} (${profile}).`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
