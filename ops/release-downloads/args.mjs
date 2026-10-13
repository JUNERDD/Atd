import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';

/** The production mirror. The release workflow passes no flags, so it always lands here. */
export const PRODUCTION_BUCKET = 'atd-releases';
export const PRODUCTION_BASE_URL = 'https://downloads.atd.best';

/**
 * The places a rehearsal can stop, in run order: after every versioned DMG is uploaded and
 * verified; after the first architecture's permanent DMG moved but before any feed did; and after
 * arm64's entries moved but before x64's.
 */
export const STOP_POINTS = ['after-immutable-upload', 'before-feed-advance', 'between-arches'];

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost']);

/**
 * Reads the command line. Without flags this is the production mirror of GitHub's latest stable
 * release. `--source-dir` rehearses against an `artifacts` workflow download instead, which may
 * carry RC versions, so it must also name a bucket and URL other than production's.
 */
export function readOptions(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      tag: { type: 'string', default: 'latest' },
      'dry-run': { type: 'boolean', default: false },
      'source-dir': { type: 'string' },
      bucket: { type: 'string' },
      'base-url': { type: 'string' },
      prefix: { type: 'string', default: '' },
      'stop-after': { type: 'string' },
    },
  });
  const sourceDir = values['source-dir'];
  const bucket = values.bucket ?? PRODUCTION_BUCKET;
  const baseUrl = values['base-url'] ?? PRODUCTION_BASE_URL;
  const { prefix } = values;
  const stopAfter = values['stop-after'];

  assert(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket), `Invalid bucket name: ${bucket}`);
  assertBaseUrl(baseUrl);
  // Keys stay below the prefix, and a listing for cleanup never reaches outside it.
  assert(
    prefix === '' || /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*\/$/.test(prefix),
    'The prefix must be empty or lowercase path segments ending in "/".',
  );
  assert(
    stopAfter === undefined || STOP_POINTS.includes(stopAfter),
    `--stop-after takes one of: ${STOP_POINTS.join(', ')}`,
  );
  if (sourceDir !== undefined) {
    assert(
      values.tag === 'latest',
      '--source-dir reads its version from manifest.json; omit --tag.',
    );
    // RC builds and rehearsal data must never reach the production download or feed.
    assert(
      values.bucket !== undefined && bucket !== PRODUCTION_BUCKET,
      '--source-dir requires an explicit, non-production --bucket.',
    );
    assert(
      values['base-url'] !== undefined && baseUrl !== PRODUCTION_BASE_URL,
      '--source-dir requires an explicit, non-production --base-url.',
    );
  }
  return {
    tag: values.tag,
    dryRun: values['dry-run'],
    sourceDir,
    bucket,
    baseUrl,
    prefix,
    stopAfter,
  };
}

/** HTTPS everywhere, except plain HTTP to this machine for a local rehearsal server. */
function assertBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid --base-url: ${value}`);
  }
  assert(
    url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)),
    '--base-url must use HTTPS (plain HTTP only for a loopback host).',
  );
  assert(
    url.origin === value && !url.username && !url.password,
    '--base-url must be a bare origin with no path, query, trailing slash, or credentials.',
  );
}
