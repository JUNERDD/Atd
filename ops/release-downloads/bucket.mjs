import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { command, SENSITIVE_ENV } from './command.mjs';
import { IMMUTABLE_CACHE, LATEST_CACHE } from './delivery.mjs';

/** Versioned DMGs kept per architecture: the newest two uploads, plus any a current feed names. */
const KEEP_PER_ARCH = 2;
const DMG_TYPE = 'application/x-apple-diskimage';

export function versionedKey(prefix, release, artifact) {
  return `${prefix}releases/${release.tag}/${artifact.name}`;
}

/** The permanent download the website links to. */
export function latestKey(prefix, arch) {
  return `${prefix}latest/Atd-${arch}.dmg`;
}

/** The feed installed Release builds read (`SUFeedURL`, chosen per architecture at build time). */
export function feedKey(prefix, feedName) {
  return `${prefix}${feedName}`;
}

export function metadataKey(prefix) {
  return `${prefix}latest.json`;
}

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
     * this mirror's versioned keys match; GitHub keeps the full release archive. RC keys match
     * only in a `--source-dir` rehearsal, and never outside its prefix.
     * @param {{ referenced: Set<string>, allowRc: boolean }} options
     */
    prune({ referenced, allowRc }) {
      const releases = `${prefix}releases/`;
      const listing = JSON.parse(
        aws(['s3api', 'list-objects-v2', '--bucket', bucket, '--prefix', releases]) || '{}',
      );
      const version = allowRc ? String.raw`\d+\.\d+\.\d+(?:-rc\.\d+)?` : String.raw`\d+\.\d+\.\d+`;
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
