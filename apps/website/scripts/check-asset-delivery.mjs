import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadEnv } from 'vite';
import { normalizeAssetBase } from '../media-assets.ts';

const { values } = parseArgs({
  options: {
    dir: { type: 'string' },
    base: { type: 'string' },
    full: { type: 'boolean', default: false },
    origin: { type: 'string', default: 'https://atd.best' },
  },
});
const directory = resolve(values.dir ?? 'dist');
const base = normalizeAssetBase(
  values.base ?? loadEnv('production', process.cwd()).VITE_ASSET_BASE_URL,
);
const manifest = JSON.parse(await readFile(resolve(directory, 'asset-manifest.json'), 'utf8'));
assert.equal(manifest.version, 1);
assert(manifest.assets.length > 0, 'Expected website media');
let total = 0;
for (const asset of manifest.assets) {
  assert(
    /^assets\/media\/(?:cases|summon)\/[\w/-]+-[a-f0-9]{16}\.(?:mp4|jpe?g|png|webp)$/.test(
      asset.key,
    ),
  );
  const data = await readFile(resolve(directory, asset.key));
  assert.equal(data.length, asset.bytes, asset.key + ': local byte count');
  assert.equal(createHash('sha256').update(data).digest('hex'), asset.sha256, asset.key);
  if (asset.key.startsWith('assets/media/'))
    assert(asset.key.includes('-' + asset.sha256.slice(0, 16) + '.'), 'Media content hash');
  total += asset.bytes;
  if (!base) continue;
  const response = await fetch(base + asset.key, {
    method: values.full ? 'GET' : 'HEAD',
    headers: { Origin: values.origin },
    signal: AbortSignal.timeout(20000),
    redirect: 'error',
  });
  assert.equal(response.status, 200, asset.key + ': CDN availability');
  assert.equal(Number(response.headers.get('content-length')), asset.bytes, asset.key + ': size');
  assert.equal(response.headers.get('content-type')?.split(';')[0], asset.contentType, asset.key);
  assert(
    ['*', values.origin].includes(response.headers.get('access-control-allow-origin')),
    asset.key + ': CORS is required for WebGPU and audio',
  );
  assert.equal(response.headers.get('cache-control'), asset.cacheControl, asset.key + ': cache');
  assert(!response.headers.get('content-encoding'), asset.key + ': preserve uploaded file bytes');
  if (values.full) {
    const remote = new Uint8Array(await response.arrayBuffer());
    assert.equal(createHash('sha256').update(remote).digest('hex'), asset.sha256, asset.key);
  }
}
for (const video of manifest.assets.filter((asset) => base && asset.contentType === 'video/mp4')) {
  const response = await fetch(base + video.key, {
    headers: { Origin: values.origin, Range: 'bytes=0-1023' },
    signal: AbortSignal.timeout(20000),
    redirect: 'error',
  });
  assert.equal(response.status, 206, 'CDN must support seeking with byte ranges');
  assert.equal(response.headers.get('content-range'), `bytes 0-1023/${video.bytes}`);
  const part = new Uint8Array(await response.arrayBuffer());
  const local = await readFile(resolve(directory, video.key));
  assert.deepEqual(part, new Uint8Array(local.subarray(0, 1024)), 'Unmodified video range');
}
console.log(
  `PASS assets — ${manifest.assets.length} files, ${(total / 1024 ** 2).toFixed(2)} MiB; local hashes${base ? ', CDN headers, CORS and video seeking' : ''}`,
);
