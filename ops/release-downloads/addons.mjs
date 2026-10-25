// The add-on archives a release pins (README: Add-ons). Each architecture's build ships its lock
// (`addons.lock.json` inside the app, published as `addons-<arch>.lock.json`), whose first URL
// for every archive is this mirror's content-addressed key. The mirror uploads each archive there
// once, immutable and never pruned: installed apps of every version keep fetching the exact
// archives their own lock names.
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { MIRROR_ORIGIN, archiveName, mirrorKey } from '../../apps/macos/scripts/addons/layout.mjs';
import { checkLock } from '../../apps/macos/scripts/addons/schema.mjs';
import { ARCHES, REPO, hashFile } from './artifacts.mjs';
import { command } from './command.mjs';
import {
  hashBody,
  holdsArtifact,
  IMMUTABLE_CACHE,
  freshUrl,
  publicUrl,
  verifyRequest,
} from './delivery.mjs';

export const ADDON_TYPE = 'application/gzip';

/** The release asset (and `--source-dir` file) holding one architecture's lock. */
export function addonLockName(arch) {
  return `addons-${arch}.lock.json`;
}

/**
 * One archive to mirror: the lock's entry plus its file name, local copy and mirror key.
 * @typedef {{ id: string, version: string, arch: string, sha256: string, size: number,
 *   name: string, file: string, key: string }} Addon
 */

/** The lock assets a GitHub release carries, for `--dry-run`. */
export function listedAddonLocks(release) {
  return ARCHES.map(({ arch }) => addonLockName(arch)).filter((name) =>
    release.assets.some((asset) => asset.name === name && asset.state === 'uploaded'),
  );
}

function uploadedAsset(release, name) {
  const asset = release.assets?.find((item) => item.name === name);
  return asset && asset.state === 'uploaded' ? asset : undefined;
}

/**
 * Reads every architecture's add-on lock the release has and returns its archives, local and
 * checked: each lock is a valid AddonLock for a DMG architecture the release ships, names this
 * mirror's key first, and every archive (downloaded from GitHub, or found in `sourceDir`) matches
 * its lock's size and SHA-256 and, on GitHub, the asset's digest. A release without locks (one
 * built before add-ons) has nothing to mirror.
 * @returns {Promise<Addon[]>}
 */
export async function readAddons(release, { sourceDir, directory, prefix }) {
  const addons = new Map();
  const from = sourceDir ?? directory;
  for (const { arch } of ARCHES) {
    const lockName = addonLockName(arch);
    if (sourceDir) {
      if (!(await stat(join(sourceDir, lockName)).catch(() => undefined))?.isFile()) continue;
    } else {
      if (!uploadedAsset(release, lockName)) continue;
      download(release, [lockName], directory);
    }
    assert(
      release.artifacts.some((artifact) => artifact.arch === arch),
      `${lockName} has no ${arch} DMG beside it.`,
    );
    const lock = JSON.parse(await readFile(join(from, lockName), 'utf8'));
    checkLock(lock, lockName);
    for (const artifact of lock.addons) {
      const name = archiveName(artifact);
      assert.equal(artifact.arch, arch, `${lockName} pins ${name} for another architecture.`);
      assert.equal(
        artifact.urls[0],
        `${MIRROR_ORIGIN}/${mirrorKey(artifact)}`,
        `${lockName} does not name this mirror's key first for ${name}.`,
      );
      if (!sourceDir) {
        const asset = uploadedAsset(release, name);
        assert(asset, `The release lacks the add-on archive ${name}.`);
        assert.equal(asset.digest, `sha256:${artifact.sha256}`, `${name} differs from its lock.`);
        assert.equal(asset.size, artifact.size, `${name}'s size differs from its lock.`);
        download(release, [name], directory);
      }
      const file = join(from, name);
      assert.equal((await stat(file)).size, artifact.size, `${name} differs from its lock's size.`);
      assert.equal(
        await hashFile(file),
        artifact.sha256,
        `${name} differs from its lock's SHA-256.`,
      );
      const key = `${prefix}${mirrorKey(artifact)}`;
      addons.set(key, { ...artifact, name, file, key });
    }
  }
  return [...addons.values()];
}

function download(release, names, directory) {
  const patterns = names.flatMap((name) => ['--pattern', name]);
  command('gh', [
    'release',
    'download',
    release.tag,
    '--repo',
    REPO,
    ...patterns,
    '--dir',
    directory,
  ]);
}

/**
 * Uploads an archive to its content-addressed key unless that key already holds the same bytes
 * (a key holding other bytes stops the run: it is immutable), then checks what the public URL
 * serves: size, type, cache policy, download name and the full SHA-256.
 */
export async function mirrorAddon({ bucket, baseUrl, addon, nonce }) {
  if (await holdsArtifact(freshUrl(baseUrl, addon.key, nonce), addon)) {
    console.log(`Already mirrored: ${addon.key}`);
  } else {
    bucket.uploadAddon(addon);
  }
  const url = publicUrl(baseUrl, addon.key);
  await verifyRequest(url, { method: 'HEAD' }, (head) => {
    assert.equal(head.status, 200, `HEAD failed for ${url.pathname}`);
    assert.equal(Number(head.headers.get('content-length')), addon.size, 'Wrong public size.');
    assert.equal(head.headers.get('content-type'), ADDON_TYPE);
    assert.equal(head.headers.get('cache-control'), IMMUTABLE_CACHE);
    assert.equal(head.headers.get('content-disposition'), `attachment; filename="${addon.name}"`);
  });
  await verifyRequest(url, { timeout: 300000 }, async (response) => {
    assert.equal(response.status, 200);
    const found = await hashBody(response);
    assert.equal(found.bytes, addon.size);
    assert.equal(found.sha256, addon.sha256, `The public ${addon.key} differs from its lock.`);
  });
  console.log(`Verified ${url.pathname.slice(1)}: size, type, cache policy, SHA-256`);
}
