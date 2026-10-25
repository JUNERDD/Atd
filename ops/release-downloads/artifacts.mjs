import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { command } from './command.mjs';

export const REPO = 'JUNERDD/Atd';
/** The CDN's object cache limit (README: Costs and delivery). */
const MAX_DMG_BYTES = 512 * 1024 ** 2;
const STABLE_VERSION = /^\d+\.\d+\.\d+$/;
const RC_VERSION = /^\d+\.\d+\.\d+-rc\.\d+$/;

/**
 * Every architecture the mirror serves, in the order their entries advance. arm64 goes first and
 * is required: its feed is the one every installed 0.7.10+ Apple silicon build reads. Releases
 * before 0.9.0 have no x64 assets; the mirror then serves an empty x64 feed.
 */
export const ARCHES = [
  { arch: 'arm64', feedName: 'appcast.xml', required: true },
  { arch: 'x64', feedName: 'appcast-x64.xml', required: false },
];

export function dmgName(version, arch) {
  return `Atd-${version}-${arch}.dmg`;
}

export async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function checkSize(size, name) {
  assert(Number.isInteger(size) && size > 0, `${name} has no size.`);
  assert(size <= MAX_DMG_BYTES, `${name} exceeds the CDN cache limit.`);
}

/**
 * One architecture's validated DMG. `file` and `feedFile` are filled once the bytes are local.
 * @typedef {{ arch: string, name: string, size: number, sha256: string, feedName: string,
 *   file?: string, feedFile?: string }} Artifact
 */

/**
 * A release to mirror: its version, the build version its feeds declare, and the artifacts it
 * has. `absent` lists the optional architectures it lacks. A GitHub release also carries its
 * `assets` (name, size, state, digest), where the add-on locks and archives are found.
 * @typedef {{ version: string, buildVersion: string, tag: string, releaseId?: number,
 *   artifacts: Artifact[], absent: string[], assets?: object[] }} Release
 */

function latestRelease() {
  const release = JSON.parse(command('gh', ['api', `repos/${REPO}/releases/latest`]));
  assert(!release.draft && !release.prerelease, 'Only stable public releases are mirrored.');
  assert(STABLE_VERSION.test(release.tag_name.slice(1)), 'Expected a stable version tag.');
  return release;
}

/** Orders `x.y.z` and `x.y.z-rc.n` versions; a release sorts after every candidate for it. */
function versionRank(version) {
  const [, major, minor, patch, rc] = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(version);
  return [major, minor, patch, rc ?? Infinity].map(Number);
}

function compareVersions(a, b) {
  const [left, right] = [versionRank(a), versionRank(b)];
  const index = left.findIndex((part, i) => part !== right[i]);
  return index === -1 ? 0 : left[index] - right[index];
}

/**
 * The rc channel's release: the newest of GitHub's latest stable release and every published
 * release candidate. A candidate must be a published prerelease with an `-rc.n` tag; other
 * prereleases (a withdrawn stable release, a beta) are never served. Once the stable release
 * catches up, it is the newest, so the channel follows it.
 */
function newestPreviewRelease() {
  const listed = JSON.parse(command('gh', ['api', `repos/${REPO}/releases?per_page=100`]));
  const candidates = listed.filter(
    (release) => !release.draft && release.prerelease && RC_VERSION.test(release.tag_name.slice(1)),
  );
  return [latestRelease(), ...candidates].reduce((newest, release) =>
    compareVersions(release.tag_name.slice(1), newest.tag_name.slice(1)) > 0 ? release : newest,
  );
}

/** The GitHub release a channel serves now. */
function channelRelease(channel) {
  return channel === 'rc' ? newestPreviewRelease() : latestRelease();
}

/** The GitHub release the channel serves, before anything is downloaded. */
export function readGitHubRelease(tag, channel) {
  const release = channelRelease(channel);
  assert(
    tag === 'latest' || tag === release.tag_name,
    'Refusing to replace the latest download with an older release.',
  );
  const version = release.tag_name.slice(1);
  const uploaded = (name) => {
    const asset = release.assets.find((item) => item.name === name);
    return asset && asset.state === 'uploaded' ? asset : undefined;
  };
  const artifacts = [];
  const absent = [];
  for (const { arch, feedName, required } of ARCHES) {
    const name = dmgName(version, arch);
    const asset = uploaded(name);
    const feed = uploaded(feedName);
    if (!asset && !feed && !required) {
      absent.push(arch);
      continue;
    }
    assert(asset, `The versioned ${arch} release DMG is missing.`);
    assert(feed, `The release's ${arch} update feed (${feedName}) is missing.`);
    assert(/^sha256:[a-f0-9]{64}$/.test(asset.digest), 'GitHub must provide a SHA-256 digest.');
    checkSize(asset.size, name);
    artifacts.push({
      arch,
      name,
      size: asset.size,
      sha256: asset.digest.slice('sha256:'.length),
      feedName,
    });
  }
  return {
    version,
    // The release workflow builds a prerelease without its `-` (0.9.0-rc.1 as 0.9.0rc.1).
    buildVersion: version.replaceAll('-', ''),
    tag: release.tag_name,
    releaseId: release.id,
    artifacts,
    absent,
    assets: release.assets,
  };
}

/** Downloads the release's DMGs and feeds and checks each DMG against GitHub's digest. */
export async function downloadGitHubRelease(release, directory) {
  const patterns = release.artifacts.flatMap(({ name, feedName }) => [
    '--pattern',
    name,
    '--pattern',
    feedName,
  ]);
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
  for (const artifact of release.artifacts) {
    artifact.file = join(directory, artifact.name);
    artifact.feedFile = join(directory, artifact.feedName);
    assert.equal(
      await hashFile(artifact.file),
      artifact.sha256,
      `The downloaded ${artifact.arch} DMG does not match GitHub's digest.`,
    );
  }
}

/** Fails the run when the channel's release changed while this one was being mirrored. */
export function assertStillLatest(release, channel) {
  assert.equal(
    channelRelease(channel).id,
    release.releaseId,
    'A newer GitHub release appeared; rerun the mirror.',
  );
}

/**
 * A flat `artifacts`-mode download (DMGs, feeds, manifest.json), or a rollback source assembled
 * the same way from an older release. Only here are RC versions accepted. Every listed DMG is
 * hashed and sized against the manifest before anything is uploaded.
 */
export async function readSourceDir(directory) {
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  const version = manifest.marketingVersion;
  const { buildVersion } = manifest;
  assert(
    typeof version === 'string' && (STABLE_VERSION.test(version) || RC_VERSION.test(version)),
    'manifest.json needs a marketingVersion such as 0.9.0 or 0.9.0-rc.3.',
  );
  assert(
    typeof buildVersion === 'string' && /^\d+(\.\d+)*(rc\.\d+)?$/.test(buildVersion),
    'manifest.json needs a buildVersion without "-", such as 0.9.0 or 0.9.0rc.3.',
  );
  assert(Array.isArray(manifest.artifacts), 'manifest.json lists no artifacts.');
  const known = new Set(ARCHES.map(({ arch }) => arch));
  const listed = new Map();
  for (const entry of manifest.artifacts) {
    assert(known.has(entry?.arch), `manifest.json names an unknown architecture: ${entry?.arch}`);
    assert(!listed.has(entry.arch), `manifest.json lists ${entry.arch} twice.`);
    listed.set(entry.arch, entry);
  }
  const artifacts = [];
  const absent = [];
  for (const { arch, feedName, required } of ARCHES) {
    const entry = listed.get(arch);
    if (!entry && !required) {
      absent.push(arch);
      continue;
    }
    assert(entry, `manifest.json has no ${arch} artifact.`);
    const name = dmgName(version, arch);
    assert.equal(entry.dmg, name, `manifest.json names the wrong ${arch} DMG.`);
    assert.equal(entry.feed, feedName, `manifest.json names the wrong ${arch} feed.`);
    assert(/^[a-f0-9]{64}$/.test(entry.sha256), `manifest.json has no ${arch} SHA-256.`);
    checkSize(entry.size, name);
    const file = join(directory, name);
    const feedFile = join(directory, feedName);
    const actual = await stat(file).catch(() => undefined);
    assert(actual?.isFile(), `${name} is missing from the source directory.`);
    assert((await stat(feedFile).catch(() => undefined))?.isFile(), `${feedName} is missing.`);
    assert.equal(actual.size, entry.size, `${name} differs from the manifest's size.`);
    assert.equal(
      await hashFile(file),
      entry.sha256,
      `${name} differs from the manifest's SHA-256.`,
    );
    artifacts.push({
      arch,
      name,
      size: entry.size,
      sha256: entry.sha256,
      feedName,
      file,
      feedFile,
    });
  }
  return { version, buildVersion, tag: `v${version}`, artifacts, absent };
}
