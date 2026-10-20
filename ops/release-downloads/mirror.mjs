// Mirrors the latest release's DMGs and update feeds, per architecture, to the R2 download
// bucket. See README.md for the stages, failure behavior, and rehearsal flags.
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listedAddonLocks, mirrorAddon, readAddons } from './addons.mjs';
import { readOptions } from './args.mjs';
import {
  ARCHES,
  assertStillLatest,
  downloadGitHubRelease,
  readGitHubRelease,
  readSourceDir,
} from './artifacts.mjs';
import {
  feedKey,
  latestKey,
  metadataKey,
  openBucket,
  publishesFeeds,
  versionedKey,
} from './bucket.mjs';
import {
  freshUrl,
  holdsArtifact,
  IMMUTABLE_CACHE,
  LATEST_CACHE,
  publicUrl,
  verifyAbsent,
  verifyDelivery,
  verifyText,
} from './delivery.mjs';
import { EMPTY_FEED, mirrorFeed } from './feeds.mjs';

const options = readOptions();
const { baseUrl, channel, prefix, sourceDir } = options;
const release = sourceDir
  ? await readSourceDir(sourceDir)
  : readGitHubRelease(options.tag, channel);
const feeds = publishesFeeds(channel);
const nonce = `${release.version}-${randomUUID()}`;
const href = (key) => publicUrl(baseUrl, key).href;

/**
 * What the channel's manifest (latest.json, rc.json) records once both architectures advanced.
 * The top-level fields keep their original arm64 meaning for existing readers; `architectures`
 * indexes every served build and leaves out one the release does not have. Only a channel that
 * publishes feeds names one.
 */
function describe() {
  const architectures = Object.fromEntries(
    release.artifacts.map((artifact) => [
      artifact.arch,
      {
        version: release.version,
        sha256: artifact.sha256,
        bytes: artifact.size,
        url: href(versionedKey(prefix, release, artifact)),
        latest: href(latestKey(prefix, channel, artifact.arch)),
        ...(feeds && { feed: href(feedKey(prefix, artifact.feedName)) }),
      },
    ]),
  );
  const { version, sha256, bytes, url } = architectures.arm64;
  return { version, sha256, bytes, url, architectures };
}

/**
 * Each artifact's versioned key and mirror feed. Every feed is checked before any write, also on
 * a channel that does not publish feeds: they must still describe exactly these DMGs.
 */
async function prepare() {
  const entries = [];
  for (const artifact of release.artifacts) {
    const key = versionedKey(prefix, release, artifact);
    const feed = mirrorFeed({
      feed: await readFile(artifact.feedFile, 'utf8'),
      release,
      artifact,
      mirrorUrl: href(key),
    });
    entries.push({ artifact, key, feed });
  }
  return entries;
}

function stopsAt(point) {
  if (options.stopAfter !== point) return false;
  console.log(`Stopped at ${point} as requested; rerun without --stop-after to finish.`);
  return true;
}

/**
 * R2 has no multi-object transaction, so the run moves forward in an order where every public
 * state is valid and a rerun recovers from any stop: upload and verify every versioned DMG and
 * every add-on archive the release's locks pin (immutable, content-addressed, never removed), then
 * move each architecture's permanent DMG and feed in turn, then the manifest, then cleanup. A feed
 * only ever names a verified DMG of its own architecture, and cleanup never removes one a current
 * feed names.
 */
async function run(directory) {
  const bucket = openBucket({ bucket: options.bucket, prefix, directory });
  if (!sourceDir) await downloadGitHubRelease(release, directory);
  const entries = await prepare();
  const addons = await readAddons(release, { sourceDir, directory, prefix });

  for (const { artifact, key } of entries) {
    // A rerun keeps an object that already holds these exact bytes.
    if (await holdsArtifact(freshUrl(baseUrl, key, nonce), artifact)) {
      console.log(`Already mirrored: ${key}`);
    } else {
      bucket.uploadImmutable(artifact, key, release.version);
    }
    await verifyDelivery({
      url: publicUrl(baseUrl, key),
      artifact,
      cacheControl: IMMUTABLE_CACHE,
      full: true,
    });
  }
  for (const addon of addons) await mirrorAddon({ bucket, baseUrl, addon, nonce });
  if (stopsAt('after-immutable-upload')) return false;
  // A rehearsal source is not a GitHub release, so there is nothing newer to defer to.
  if (!sourceDir) assertStillLatest(release, channel);

  for (const [index, { arch, feedName }] of ARCHES.entries()) {
    if (index > 0 && stopsAt('between-arches')) return false;
    const entry = entries.find(({ artifact }) => artifact.arch === arch);
    const latest = latestKey(prefix, channel, arch);
    if (entry) {
      bucket.promote(entry.artifact, entry.key, latest, release.version);
      await verifyDelivery({
        url: freshUrl(baseUrl, latest, nonce),
        artifact: entry.artifact,
        cacheControl: LATEST_CACHE,
        full: false,
      });
    } else {
      // A release without this architecture (an older release, or a rollback to one) withdraws
      // its download rather than leave a build the latest release no longer offers.
      bucket.remove(latest);
      await verifyAbsent(freshUrl(baseUrl, latest, nonce));
    }
    if (index === 0 && stopsAt('before-feed-advance')) return false;
    if (!feeds) continue;
    const feed = feedKey(prefix, feedName);
    const body = entry ? entry.feed : EMPTY_FEED;
    await bucket.putText(feed, body, 'application/xml');
    await verifyText({
      url: freshUrl(baseUrl, feed, nonce),
      expected: body,
      cacheControl: LATEST_CACHE,
    });
  }

  const metadata = `${JSON.stringify(describe(), null, 2)}\n`;
  const manifestKey = metadataKey(prefix, channel);
  await bucket.putText(manifestKey, metadata, 'application/json');
  await verifyText({
    url: freshUrl(baseUrl, manifestKey, nonce),
    expected: metadata,
    cacheControl: LATEST_CACHE,
  });
  bucket.prune({
    referenced: new Set(entries.map(({ key }) => key)),
    versions: channel === 'rc' ? 'rc' : sourceDir ? 'any' : 'stable',
  });
  return true;
}

console.log(
  JSON.stringify({
    ...describe(),
    absent: release.absent,
    channel,
    source: sourceDir ? 'source-dir' : 'github',
    bucket: options.bucket,
    prefix,
    dryRun: options.dryRun,
  }),
);
if (options.dryRun) {
  // A local source can be checked completely; a GitHub release's feeds and add-ons are not
  // downloaded, only its add-on locks named.
  if (sourceDir) {
    await prepare();
    const addons = await readAddons(release, { sourceDir, prefix });
    console.log(JSON.stringify({ addons: addons.map(({ key, size }) => ({ key, size })) }));
  } else {
    console.log(JSON.stringify({ addonLocks: listedAddonLocks(release) }));
  }
  process.exit(0);
}

const directory = await mkdtemp(join(tmpdir(), 'atd-release-mirror-'));
try {
  if (await run(directory)) {
    const served = release.artifacts.map(({ arch }) => arch).join(', ');
    console.log(
      `Published ${release.version} (${served}) to the ${channel} channel; its downloads${feeds ? ' and feeds' : ''} expire within 60 seconds.`,
    );
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
