import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    tag: { type: 'string', default: 'latest' },
    'dry-run': { type: 'boolean', default: false },
  },
});
const repo = 'JUNERDD/Atd';
const bucket = 'atd-releases';
const base = 'https://downloads.atd.best';
const latestKey = 'latest/Atd-arm64.dmg';
// Installed Release builds read this feed (SUFeedURL in apps/macos/project.yml).
const feedKey = 'appcast.xml';
const immutableCache = 'public, max-age=31536000, immutable';
const latestCache = 'public, max-age=60, must-revalidate';
const sensitive = ['R2_DOWNLOAD_ACCOUNT_ID', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];

function command(executable, args) {
  const result = spawnSync(executable, args, { encoding: 'utf8', maxBuffer: 16 * 1024 ** 2 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    let message = result.stderr || result.stdout;
    for (const name of sensitive) {
      if (process.env[name]) message = message.replaceAll(process.env[name], '[redacted]');
    }
    throw new Error(`${executable} failed (${result.status}): ${message}`);
  }
  return result.stdout;
}

function latestRelease() {
  return JSON.parse(command('gh', ['api', `repos/${repo}/releases/latest`]));
}

const release = latestRelease();
assert(!release.draft && !release.prerelease, 'Only stable public releases are mirrored.');
assert(/^v\d+\.\d+\.\d+$/.test(release.tag_name), 'Expected a stable version tag.');
assert(
  values.tag === 'latest' || values.tag === release.tag_name,
  'Refusing to replace the latest download with an older release.',
);
const version = release.tag_name.slice(1);
const name = `Atd-${version}-arm64.dmg`;
const asset = release.assets.find((item) => item.name === name);
assert(asset && asset.state === 'uploaded', 'The versioned release DMG is missing.');
assert(/^sha256:[a-f0-9]{64}$/.test(asset.digest), 'GitHub must provide a SHA-256 asset digest.');
assert(asset.size > 0 && asset.size <= 512 * 1024 ** 2, 'The DMG exceeds the CDN cache limit.');
const sha256 = asset.digest.slice('sha256:'.length);
const feedAsset = release.assets.find((item) => item.name === feedKey);
assert(feedAsset && feedAsset.state === 'uploaded', 'The release update feed is missing.');
const versionKey = `releases/${release.tag_name}/${name}`;
const disposition = `attachment; filename="${name}"`;
const runNonce = randomUUID();
const metadata = { version, sha256, bytes: asset.size, url: `${base}/${versionKey}` };
console.log(
  JSON.stringify({
    ...metadata,
    latest: `${base}/${latestKey}`,
    feed: `${base}/${feedKey}`,
    dryRun: values['dry-run'],
  }),
);
if (values['dry-run']) process.exit(0);

for (const key of sensitive) assert(process.env[key], `Missing ${key}.`);
assert(/^[a-f0-9]{32}$/.test(process.env.R2_DOWNLOAD_ACCOUNT_ID), 'Invalid R2 account ID.');
const endpoint = `https://${process.env.R2_DOWNLOAD_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const directory = await mkdtemp(join(tmpdir(), 'atd-release-mirror-'));
const file = join(directory, name);
const metadataFile = join(directory, 'latest.json');
const releaseFeedFile = join(directory, feedKey);
const mirrorFeedFile = join(directory, 'mirror-appcast.xml');

function aws(args) {
  return command('aws', [...args, '--endpoint-url', endpoint, '--region', 'auto']);
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

function pruneOldMirrors() {
  const listing = JSON.parse(
    aws(['s3api', 'list-objects-v2', '--bucket', bucket, '--prefix', 'releases/']),
  );
  const previous = (listing.Contents ?? [])
    .filter(
      (item) =>
        item.Key !== versionKey && /^releases\/v(\d+\.\d+\.\d+)\/Atd-\1-arm64\.dmg$/.test(item.Key),
    )
    .sort((a, b) => b.LastModified.localeCompare(a.LastModified));
  // Only this mirror's versioned keys are eligible. GitHub keeps the full archive.
  for (const item of previous.slice(2)) {
    aws(['s3api', 'delete-object', '--bucket', bucket, '--key', item.Key]);
    console.log(`Removed old mirror: ${item.Key}`);
  }
}

/**
 * The release's signed feed, re-pointed at the verified mirror copy. Sparkle's EdDSA signature
 * covers the dmg's bytes, not its URL, and the mirror holds exactly those bytes, so the release
 * job's signature and length stay valid. The GitHub feed keeps the GitHub URL for installs that
 * still read it.
 */
async function mirrorFeed() {
  const feed = await readFile(releaseFeedFile, 'utf8');
  const source = `url="https://github.com/${repo}/releases/download/${release.tag_name}/${name}"`;
  assert.equal(feed.split(source).length, 2, 'The release feed must name its dmg exactly once.');
  assert(feed.includes(` length="${asset.size}"`), 'The release feed names a different dmg size.');
  return feed.replace(source, `url="${base}/${versionKey}"`);
}

async function verifyFeed(expected) {
  const url = new URL(`${base}/${feedKey}`);
  url.searchParams.set('verify', `${version}-${runNonce}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, `GET failed for ${feedKey}`);
  assert.equal(response.headers.get('cache-control'), latestCache);
  assert.equal(await response.text(), expected, 'The public update feed differs.');
  console.log(`Verified ${feedKey}: content, cache policy`);
}

async function verifyDelivery(key, cacheControl, full) {
  // A query unique to this run bypasses every earlier cached copy of the latest object. A version
  // alone is not enough on a rerun: the promoted bytes keep their ETag, so the edge revalidates its
  // earlier entry with a 304 and goes on serving that entry's headers.
  const url = new URL(`${base}/${key}`);
  if (key === latestKey) url.searchParams.set('verify', `${version}-${runNonce}`);
  const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(30000) });
  assert.equal(head.status, 200, `HEAD failed for ${key}`);
  assert.equal(Number(head.headers.get('content-length')), asset.size, 'Wrong public file size.');
  assert.equal(head.headers.get('content-type'), 'application/x-apple-diskimage');
  assert.equal(head.headers.get('cache-control'), cacheControl);
  // Both keys save under the versioned name, so a download from the permanent URL names its version.
  assert.equal(head.headers.get('content-disposition'), disposition, 'Wrong download filename.');
  const source = await open(file, 'r');
  try {
    for (const start of [0, asset.size - 65536]) {
      const end = start + 65535;
      const response = await fetch(url, {
        headers: { Range: `bytes=${start}-${end}` },
        signal: AbortSignal.timeout(30000),
      });
      assert.equal(response.status, 206, 'Byte-range downloads must work.');
      assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${asset.size}`);
      const expected = Buffer.alloc(65536);
      await source.read(expected, 0, expected.length, start);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected, 'Range bytes changed.');
    }
  } finally {
    await source.close();
  }
  if (full) {
    const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
    assert.equal(response.status, 200);
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of response.body) {
      hash.update(chunk);
      bytes += chunk.length;
    }
    assert.equal(bytes, asset.size);
    assert.equal(
      hash.digest('hex'),
      sha256,
      'The public mirror differs from the signed GitHub DMG.',
    );
  }
  console.log(`Verified ${key}: size, cache policy, byte ranges${full ? ', SHA-256' : ''}`);
}

try {
  command('gh', [
    'release',
    'download',
    release.tag_name,
    '--repo',
    repo,
    '--pattern',
    name,
    '--pattern',
    feedKey,
    '--dir',
    directory,
  ]);
  assert.equal(await hashFile(file), sha256, 'Downloaded release digest does not match GitHub.');
  const feed = await mirrorFeed();
  // The official AWS CLI owns multipart uploads, retries, and S3 authentication.
  // Wrangler's single-upload limit is smaller than the current DMG.
  aws([
    's3',
    'cp',
    file,
    `s3://${bucket}/${versionKey}`,
    '--content-type',
    'application/x-apple-diskimage',
    '--content-disposition',
    disposition,
    '--cache-control',
    immutableCache,
    '--metadata',
    `sha256=${sha256},version=${version}`,
    '--only-show-errors',
    '--no-progress',
  ]);
  await verifyDelivery(versionKey, immutableCache, true);
  assert.equal(
    latestRelease().id,
    release.id,
    'A newer GitHub release appeared; rerun the mirror.',
  );
  aws([
    's3api',
    'copy-object',
    '--bucket',
    bucket,
    '--key',
    latestKey,
    '--copy-source',
    `${bucket}/${versionKey}`,
    '--metadata-directive',
    'REPLACE',
    '--content-type',
    'application/x-apple-diskimage',
    '--content-disposition',
    disposition,
    '--cache-control',
    latestCache,
    '--metadata',
    `sha256=${sha256},version=${version}`,
  ]);
  await verifyDelivery(latestKey, latestCache, false);
  // Published only after the versioned dmg it names passed verification, so an installed app is
  // never offered an update the mirror cannot serve.
  await writeFile(mirrorFeedFile, feed);
  aws([
    's3',
    'cp',
    mirrorFeedFile,
    `s3://${bucket}/${feedKey}`,
    '--content-type',
    'application/xml',
    '--cache-control',
    latestCache,
    '--only-show-errors',
  ]);
  await verifyFeed(feed);
  await writeFile(metadataFile, `${JSON.stringify(metadata, null, 2)}\n`);
  aws([
    's3',
    'cp',
    metadataFile,
    `s3://${bucket}/latest.json`,
    '--content-type',
    'application/json',
    '--cache-control',
    latestCache,
    '--only-show-errors',
  ]);
  pruneOldMirrors();
  console.log(
    `Published ${version}; the stable download and feed caches expire within 60 seconds.`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
