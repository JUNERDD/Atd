import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ADDON_TYPE } from './addons.mjs';
import { command, SENSITIVE_ENV } from './command.mjs';
import { IMMUTABLE_CACHE, LATEST_CACHE } from './delivery.mjs';

/** Versioned DMGs kept per architecture: the newest two uploads, plus any a current feed names. */
const KEEP_PER_ARCH = 2;
const DMG_TYPE = 'application/x-apple-diskimage';

export function versionedKey(prefix, release, artifact) {
  return `${prefix}releases/${release.tag}/${artifact.name}`;
}

/**
 * Where each channel's permanent objects live. Only the stable channel publishes update feeds:
 * installed builds read those, while the rc channel serves the website's preview downloads.
 */
const CHANNEL_KEYS = {
  stable: { directory: 'latest', manifest: 'latest.json', feeds: true },
  rc: { directory: 'rc', manifest: 'rc.json', feeds: false },
};

export function publishesFeeds(channel) {
  return CHANNEL_KEYS[channel].feeds;
}

/** The permanent download the website links to. */
export function latestKey(prefix, channel, arch) {
  return `${prefix}${CHANNEL_KEYS[channel].directory}/Atd-${arch}.dmg`;
}

/** The feed installed Release builds read (`SUFeedURL`, chosen per architecture at build time). */
export function feedKey(prefix, feedName) {
  return `${prefix}${feedName}`;
}

export function metadataKey(prefix, channel) {
  return `${prefix}${CHANNEL_KEYS[channel].manifest}`;
}

/** The versions of the versioned keys a prune may remove; each channel cleans only its own. */
const PRUNABLE_VERSIONS = {
  stable: String.raw`\d+\.\d+\.\d+`,
  rc: String.raw`\d+\.\d+\.\d+-rc\.\d+`,
  any: String.raw`\d+\.\d+\.\d+(?:-rc\.\d+)?`,
};

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The bucket's S3 API through the official AWS CLI, which owns multipart uploads, request
 * retries (`AWS_RETRY_MODE`), and S3 authentication; Wrangler's single-upload limit is smaller
 * than the current DMG. Credentials come from the environment and are never printed.
 * @param {{ bucket: string, prefix: string, directory: string }} options `directory` holds the
 *   small files this run writes before uploading them.
 */
export function openBucket({ bucket, prefix, directory }) {
  for (const name of SENSITIVE_ENV) assert(process.env[name], `Missing ${name}.`);
  assert(/^[a-f0-9]{32}$/.test(process.env.R2_DOWNLOAD_ACCOUNT_ID), 'Invalid R2 account ID.');
  const endpoint = `https://${process.env.R2_DOWNLOAD_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const aws = (args) => command('aws', [...args, '--endpoint-url', endpoint, '--region', 'auto']);
  const dmgHeaders = (artifact, version, cacheControl) => [
    '--content-type',
    DMG_TYPE,
    '--content-disposition',
    `attachment; filename="${artifact.name}"`,
    '--cache-control',
    cacheControl,
    '--metadata',
    `sha256=${artifact.sha256},version=${version}`,
  ];

  return {
    /** Uploads a versioned DMG under the one-year immutable cache policy. */
    uploadImmutable(artifact, key, version) {
      aws([
        's3',
        'cp',
        artifact.file,
        `s3://${bucket}/${key}`,
        ...dmgHeaders(artifact, version, IMMUTABLE_CACHE),
        '--only-show-errors',
        '--no-progress',
      ]);
    },

    /**
     * Uploads an add-on archive to its content-addressed key under the one-year immutable cache
     * policy (addons.mjs). Its download name is the release asset's.
     * @param {import('./addons.mjs').Addon} addon
     */
    uploadAddon(addon) {
      aws([
        's3',
        'cp',
        addon.file,
        `s3://${bucket}/${addon.key}`,
        '--content-type',
        ADDON_TYPE,
        '--content-disposition',
        `attachment; filename="${addon.name}"`,
        '--cache-control',
        IMMUTABLE_CACHE,
        '--metadata',
        `sha256=${addon.sha256},version=${addon.version}`,
        '--only-show-errors',
        '--no-progress',
      ]);
    },

    /** Server-side copies a verified versioned DMG to its architecture's permanent URL. */
    promote(artifact, sourceKey, key, version) {
      aws([
        's3api',
        'copy-object',
        '--bucket',
        bucket,
        '--key',
        key,
        '--copy-source',
        `${bucket}/${sourceKey}`,
        '--metadata-directive',
        'REPLACE',
        ...dmgHeaders(artifact, version, LATEST_CACHE),
      ]);
    },

    /** Writes a feed or manifest under the 60-second cache policy. */
    async putText(key, body, contentType) {
      const file = join(directory, key.replaceAll('/', '_'));
      await writeFile(file, body);
      aws([
        's3',
        'cp',
        file,
        `s3://${bucket}/${key}`,
        '--content-type',
        contentType,
        '--cache-control',
        LATEST_CACHE,
        '--only-show-errors',
      ]);
    },

    /** Deletes one object; deleting a missing key succeeds, so a rerun can repeat it. */
    remove(key) {
      aws(['s3api', 'delete-object', '--bucket', bucket, '--key', key]);
    },

    /**
     * Removes older versioned DMGs below the prefix, grouped by architecture, keeping each
     * group's newest uploads and every key in `referenced` (what the current feeds name). Only
     * this mirror's versioned keys of the given versions match: stable ones for the stable
     * channel, RC ones for the rc channel, and both in a stable `--source-dir` rehearsal, never
     * outside its prefix. GitHub keeps the full release archive.
     * @param {{ referenced: Set<string>, versions: keyof typeof PRUNABLE_VERSIONS }} options
     */
    prune({ referenced, versions }) {
      const releases = `${prefix}releases/`;
      const listing = JSON.parse(
        aws(['s3api', 'list-objects-v2', '--bucket', bucket, '--prefix', releases]) || '{}',
      );
      const version = PRUNABLE_VERSIONS[versions];
      const pattern = new RegExp(
        `^${escapeRegExp(releases)}v(${version})/Atd-\\1-(arm64|x64)\\.dmg$`,
      );
      const groups = new Map();
      for (const item of listing.Contents ?? []) {
        const arch = pattern.exec(item.Key)?.[2];
        if (!arch) continue;
        groups.set(arch, [...(groups.get(arch) ?? []), item]);
      }
      for (const items of groups.values()) {
        items.sort((a, b) => b.LastModified.localeCompare(a.LastModified));
        for (const item of items.slice(KEEP_PER_ARCH)) {
          if (referenced.has(item.Key)) continue;
          aws(['s3api', 'delete-object', '--bucket', bucket, '--key', item.Key]);
          console.log(`Removed old mirror: ${item.Key}`);
        }
      }
    },
  };
}
