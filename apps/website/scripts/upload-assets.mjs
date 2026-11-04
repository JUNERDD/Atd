/**
 * Publishes the build's media (`dist/asset-manifest.json`) to an R2 bucket through its S3 API,
 * uploading only the keys the bucket lacks. Each key carries a hash of its bytes, so an object
 * already there holds those bytes; one whose size disagrees fails instead of being overwritten
 * under caches that may hold it. Nothing is ever deleted, so earlier deployments keep their media.
 *
 * Credentials are the S3 pair of an R2 API token scoped to the bucket (Object Read & Write), read
 * from the environment and never printed: R2_ASSETS_ACCOUNT_ID, R2_ASSETS_ACCESS_KEY_ID and
 * R2_ASSETS_SECRET_ACCESS_KEY. With `--if-configured` a build without them (local, a fork's
 * preview) skips the upload and leaves `assets:check` to judge the media's delivery.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { AwsClient } from 'aws4fetch';

const { values } = parseArgs({
  options: {
    bucket: { type: 'string' },
    dir: { type: 'string', default: 'dist' },
    'dry-run': { type: 'boolean', default: false },
    'if-configured': { type: 'boolean', default: false },
  },
});
assert(values.bucket, 'Pass --bucket with the target R2 bucket name.');
const CREDENTIALS = [
  'R2_ASSETS_ACCOUNT_ID',
  'R2_ASSETS_ACCESS_KEY_ID',
  'R2_ASSETS_SECRET_ACCESS_KEY',
];
/** Parallel requests to the bucket; the S3 API takes these comfortably. */
const PARALLEL = 8;

const directory = resolve(values.dir);
const manifest = JSON.parse(await readFile(resolve(directory, 'asset-manifest.json'), 'utf8'));
assert.equal(manifest.version, 1);
assert(manifest.assets.length > 0, 'Expected website media.');
const files = new Map();
for (const asset of manifest.assets) {
  assert(
    /^assets\/media\/(?:cases|summon)\/[\w/-]+-[a-f0-9]{16}\.(?:mp4|jpe?g|png|webp)$/.test(
      asset.key,
    ),
  );
  assert(asset.key.includes('-' + asset.sha256.slice(0, 16) + '.'));
  assert.equal(asset.cacheControl, 'public, max-age=31536000, immutable');
  const data = await readFile(resolve(directory, asset.key));
  assert.equal(data.length, asset.bytes, asset.key);
  assert.equal(createHash('sha256').update(data).digest('hex'), asset.sha256, asset.key);
  files.set(asset.key, data);
}

const unset = CREDENTIALS.filter((name) => !process.env[name]?.trim());
if (unset.length > 0) {
  const names = unset.join(', ');
  if (!values['if-configured'] && !values['dry-run']) throw new Error(`Set ${names} to upload.`);
  console.log(
    `Validated ${manifest.assets.length} files; upload skipped (${names} unset), so assets:check decides whether their delivery passes.`,
  );
  process.exit(0);
}

const env = Object.fromEntries(CREDENTIALS.map((name) => [name, process.env[name].trim()]));
const client = new AwsClient({
  accessKeyId: env.R2_ASSETS_ACCESS_KEY_ID,
  secretAccessKey: env.R2_ASSETS_SECRET_ACCESS_KEY,
  service: 's3',
  region: 'auto',
  // aws4fetch retries 5xx and 429 responses with backoff.
  retries: 4,
});
const endpoint = `https://${env.R2_ASSETS_ACCOUNT_ID}.r2.cloudflarestorage.com/${values.bucket}/`;

/** Runs `task` over `items` with at most `limit` running at once. */
async function eachLimited(items, limit, task) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await task(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** One signed request for a key; failures name the key, never the endpoint or credentials. */
async function request(asset, method, init = {}) {
  try {
    return await client.fetch(endpoint + asset.key, {
      method,
      ...init,
      signal: AbortSignal.timeout(60000),
    });
  } catch (error) {
    throw new Error(`${asset.key}: R2 ${method} failed`, { cause: error });
  }
}

const missing = [];
await eachLimited(manifest.assets, PARALLEL, async (asset) => {
  const response = await request(asset, 'HEAD');
  await response.body?.cancel();
  if (response.status === 404) {
    missing.push(asset);
    return;
  }
  assert.equal(response.status, 200, `${asset.key}: R2 HEAD`);
  // Same hash, same bytes: a different size means the stored object is not this file.
  assert.equal(
    Number(response.headers.get('content-length')),
    asset.bytes,
    `${asset.key}: the bucket holds different bytes under this content-addressed key`,
  );
});

let bytes = 0;
if (!values['dry-run']) {
  await eachLimited(missing, PARALLEL, async (asset) => {
    const response = await request(asset, 'PUT', {
      body: files.get(asset.key),
      headers: { 'Content-Type': asset.contentType, 'Cache-Control': asset.cacheControl },
    });
    await response.body?.cancel();
    assert.equal(response.status, 200, `${asset.key}: R2 PUT`);
    bytes += asset.bytes;
    console.log(`Uploaded ${asset.key}`);
  });
}
console.log(
  `${values['dry-run'] ? 'Would upload' : 'Uploaded'} ${missing.length} of ${manifest.assets.length} files` +
    `${values['dry-run'] ? '' : ` (${(bytes / 1024 ** 2).toFixed(2)} MiB)`}; ` +
    `${manifest.assets.length - missing.length} already in ${values.bucket}; no objects deleted`,
);
