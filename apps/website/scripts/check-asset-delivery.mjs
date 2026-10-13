import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { loadEnv } from 'vite';
import { waitForHttpRetry } from '../../../scripts/http-retry.mjs';
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

async function requestAsset(key, method, range) {
  const label = `${key}: CDN ${method}${range ? ` ${range}` : ''}`;
  const attempts = 3;
  for (let attempt = 1; ; attempt += 1) {
    const signal = AbortSignal.timeout(20000);
    let failure;
    let retryAfter;
    try {
      const response = await fetch(base + key, {
        method,
        headers: { Origin: values.origin, ...(range ? { Range: range } : {}) },
        signal,
        redirect: 'error',
      });
      // Retry gateway failures, but leave missing assets and invalid headers to the assertions.
      if (![502, 503, 504].includes(response.status)) {
        const body =
          method === 'GET' && response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
        if (!response.ok) await response.body?.cancel();
        return { response, body };
      }
      failure = new Error(`HTTP ${response.status}`);
      retryAfter = response.headers.get('retry-after');
      await response.body?.cancel();
    } catch (error) {
      const code = error.cause?.code ?? error.code;
      const timedOut =
        signal.aborted ||
        [
          'ETIMEDOUT',
          'UND_ERR_CONNECT_TIMEOUT',
          'UND_ERR_HEADERS_TIMEOUT',
          'UND_ERR_BODY_TIMEOUT',
        ].includes(code);
      if (!timedOut) throw new Error(`${label}: request failed`, { cause: error });
      failure = error;
    }
    await waitForHttpRetry({ label, attempt, attempts, failure, retryAfter });
  }
}

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
  const { response, body } = await requestAsset(asset.key, values.full ? 'GET' : 'HEAD');
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
    assert.equal(createHash('sha256').update(body).digest('hex'), asset.sha256, asset.key);
  }
}
for (const video of manifest.assets.filter((asset) => base && asset.contentType === 'video/mp4')) {
  const { response, body } = await requestAsset(video.key, 'GET', 'bytes=0-1023');
  assert.equal(response.status, 206, video.key + ': CDN must support seeking with byte ranges');
  assert.equal(response.headers.get('content-range'), `bytes 0-1023/${video.bytes}`, video.key);
  const local = await readFile(resolve(directory, video.key));
  assert.deepEqual(
    body,
    new Uint8Array(local.subarray(0, 1024)),
    video.key + ': unmodified video range',
  );
}
console.log(
  `PASS assets — ${manifest.assets.length} files, ${(total / 1024 ** 2).toFixed(2)} MiB; local hashes${base ? ', CDN headers, CORS and video seeking' : ''}`,
);
