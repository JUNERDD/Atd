import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    bucket: { type: 'string' },
    dir: { type: 'string', default: 'dist' },
    'dry-run': { type: 'boolean', default: false },
  },
});
assert(values.bucket, 'Pass --bucket with the target R2 bucket name.');
const directory = resolve(values.dir);
const manifest = JSON.parse(await readFile(resolve(directory, 'asset-manifest.json'), 'utf8'));
assert.equal(manifest.version, 1);
assert(manifest.assets.length > 0, 'Expected website media.');
let bytes = 0;
for (const asset of manifest.assets) {
  assert(
    /^assets\/media\/(?:cases|summon)\/[\w/-]+-[a-f0-9]{16}\.(?:mp4|jpe?g|png|webp)$/.test(
      asset.key,
    ),
  );
  assert(asset.key.includes('-' + asset.sha256.slice(0, 16) + '.'));
  assert.equal(asset.cacheControl, 'public, max-age=31536000, immutable');
  const path = resolve(directory, asset.key);
  const data = await readFile(path);
  assert.equal(data.length, asset.bytes, asset.key);
  assert.equal(createHash('sha256').update(data).digest('hex'), asset.sha256, asset.key);
  bytes += data.length;
}
for (const asset of manifest.assets) {
  if (values['dry-run']) continue;
  const path = resolve(directory, asset.key);
  // Wrangler owns authentication and binary uploads. Never put credentials into VITE_*.
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'wrangler',
      'r2',
      'object',
      'put',
      `${values.bucket}/${asset.key}`,
      '--remote',
      '--file',
      path,
      '--content-type',
      asset.contentType,
      '--cache-control',
      asset.cacheControl,
    ],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Upload failed: ' + asset.key);
}
console.log(
  `${values['dry-run'] ? 'Validated upload plan' : 'Uploaded'}: ${manifest.assets.length} files, ${(bytes / 1024 ** 2).toFixed(2)} MiB; no objects deleted`,
);
