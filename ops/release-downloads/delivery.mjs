import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { waitForHttpRetry } from '../../scripts/http-retry.mjs';

export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
export const LATEST_CACHE = 'public, max-age=60, must-revalidate';
const RANGE_BYTES = 65536;

/** The public URL of an object under `--base-url`. */
export function publicUrl(baseUrl, key) {
  return new URL(`${baseUrl}/${key}`);
}

/**
 * The same URL with a query unique to this run, which bypasses every earlier cached copy. A
 * version alone is not enough on a rerun: promoted bytes keep their ETag, so the edge revalidates
 * its earlier entry with a 304 and goes on serving that entry's headers. A lookup for an object
 * that is not there yet uses one too, so its 404 can never be cached for the plain URL.
 */
export function freshUrl(baseUrl, key, nonce) {
  const url = publicUrl(baseUrl, key);
  url.searchParams.set('verify', nonce);
  return url;
}

/**
 * One public read, retried on timeouts and HTTP 502/503/504 under the shared HTTP retry policy.
 * `verify` receives every other response and its result is returned; its assertions fail at once.
 */
export async function verifyRequest(url, { method = 'GET', range, timeout = 30000 }, verify) {
  const label = `${url.pathname.slice(1)}: ${method}${range ? ` ${range}` : ''}`;
  const attempts = 3;
  for (let attempt = 1; ; attempt += 1) {
    const signal = AbortSignal.timeout(timeout);
    let response;
    let failure;
    let retryAfter;
    try {
      response = await fetch(url, {
        method,
        headers: range ? { Range: range } : undefined,
        signal,
      });
      // Keep body reads inside the attempt; a full-download retry starts a fresh hash.
      if (![502, 503, 504].includes(response.status)) return await verify(response);
      failure = new Error(`HTTP ${response.status}`);
      retryAfter = response.headers.get('retry-after');
    } catch (error) {
      const code = error.cause?.code ?? error.code;
      const timedOut =
        (signal.aborted && ['TimeoutError', 'AbortError'].includes(error.name)) ||
        [
          'ETIMEDOUT',
          'UND_ERR_CONNECT_TIMEOUT',
          'UND_ERR_HEADERS_TIMEOUT',
          'UND_ERR_BODY_TIMEOUT',
        ].includes(code);
      if (!timedOut) throw new Error(`${label}: verification failed`, { cause: error });
      failure = new Error(
        signal.aborted ? `Timed out after ${timeout} ms` : `Transport timeout (${code})`,
        { cause: error },
      );
    } finally {
      // Discard unread error responses without replacing the original failure with a cleanup error.
      await response?.body?.cancel().catch(() => {});
    }
    await waitForHttpRetry({ label, attempt, attempts, failure, retryAfter });
  }
}

export async function hashBody(response) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of response.body) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest('hex') };
}

function disposition(artifact) {
  return `attachment; filename="${artifact.name}"`;
}

/**
 * Whether a versioned object already holds this artifact's exact bytes, so a rerun can skip its
 * upload. An object with other bytes is never replaced: its one-year immutable copies may already
 * sit in caches, and only a new version can change what that URL serves.
 * @param {URL} url A {@link freshUrl} for the versioned key.
 * @param {import('./artifacts.mjs').Artifact} artifact
 */
export async function holdsArtifact(url, artifact) {
  const exists = await verifyRequest(url, { method: 'HEAD' }, (head) => {
    if (head.status === 404) return false;
    assert.equal(head.status, 200, `Unexpected HTTP ${head.status} for ${url.pathname}`);
    return true;
  });
  if (!exists) return false;
  const found = await verifyRequest(url, { timeout: 300000 }, async (response) => {
    assert.equal(response.status, 200, `GET failed for ${url.pathname}`);
    return hashBody(response);
  });
  assert(
    found.bytes === artifact.size && found.sha256 === artifact.sha256,
    `${url.pathname} already holds different bytes; refusing to replace an immutable object.`,
  );
  return true;
}

/**
 * Checks a public DMG: size, type, cache policy, download name, both end byte ranges against the
 * local file, and with `full` the whole body's SHA-256.
 * @param {object} input
 * @param {URL} input.url
 * @param {import('./artifacts.mjs').Artifact} input.artifact
 * @param {string} input.cacheControl
 * @param {boolean} input.full
 */
export async function verifyDelivery({ url, artifact, cacheControl, full }) {
  const { size } = artifact;
  await verifyRequest(url, { method: 'HEAD' }, (head) => {
    assert.equal(head.status, 200, `HEAD failed for ${url.pathname}`);
    assert.equal(Number(head.headers.get('content-length')), size, 'Wrong public file size.');
    assert.equal(head.headers.get('content-type'), 'application/x-apple-diskimage');
    assert.equal(head.headers.get('cache-control'), cacheControl);
    // Both keys save under the versioned name, so a download from the permanent URL names its version.
    assert.equal(
      head.headers.get('content-disposition'),
      disposition(artifact),
      'Wrong download filename.',
    );
  });
  const length = Math.min(RANGE_BYTES, size);
  const source = await open(artifact.file, 'r');
  try {
    for (const start of new Set([0, size - length])) {
      const end = start + length - 1;
      const expected = Buffer.alloc(length);
      await source.read(expected, 0, length, start);
      await verifyRequest(url, { range: `bytes=${start}-${end}` }, async (response) => {
        assert.equal(response.status, 206, 'Byte-range downloads must work.');
        assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${size}`);
        assert.deepEqual(
          Buffer.from(await response.arrayBuffer()),
          expected,
          'Range bytes changed.',
        );
      });
    }
  } finally {
    await source.close();
  }
  if (full) {
    await verifyRequest(url, { timeout: 300000 }, async (response) => {
      assert.equal(response.status, 200);
      const found = await hashBody(response);
      assert.equal(found.bytes, size);
      assert.equal(found.sha256, artifact.sha256, 'The public mirror differs from the signed DMG.');
    });
  }
  console.log(
    `Verified ${url.pathname.slice(1)}: size, cache policy, byte ranges${full ? ', SHA-256' : ''}`,
  );
}

/** Checks a small public text object (a feed or latest.json) byte for byte. */
export async function verifyText({ url, expected, cacheControl }) {
  await verifyRequest(url, {}, async (response) => {
    assert.equal(response.status, 200, `GET failed for ${url.pathname}`);
    assert.equal(response.headers.get('cache-control'), cacheControl);
    assert.equal(await response.text(), expected, `The public ${url.pathname} differs.`);
  });
  console.log(`Verified ${url.pathname.slice(1)}: content, cache policy`);
}

/** Checks that a withdrawn object is gone from the origin. */
export async function verifyAbsent(url) {
  await verifyRequest(url, { method: 'HEAD' }, (head) => {
    assert.equal(head.status, 404, `${url.pathname} is still served (HTTP ${head.status}).`);
  });
  console.log(`Verified ${url.pathname.slice(1)}: removed`);
}
