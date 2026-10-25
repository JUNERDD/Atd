import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, open, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { errorMessage, type AddonArtifact } from '@atd/agent-contracts';
import { AddonFailure } from './failure.js';

/** A download that receives nothing for this long is abandoned as a network failure. */
const STALL_MS = 60_000;

/** What one download needs besides the archive it fetches. */
export interface DownloadOptions {
  /** The file the archive is written to; it must not exist. */
  file: string;
  /** Aborts the download (cancel, shutdown). */
  signal: AbortSignal;
  /** `file:` URLs are honored only by a development service. */
  development: boolean;
  /** Bytes received so far, after each chunk. */
  onProgress: (received: number) => void;
}

/**
 * Downloads the archive the lock pins, trying its URLs in order. `https:` goes through the global
 * fetch, whose dispatcher follows the macOS proxy settings (network/system-proxy.ts). Size and
 * SHA-256 are checked while the bytes stream to disk: more bytes than the lock's size stop at
 * once, and a finished download whose size or hash differs fails with `integrity`, without trying
 * another URL, since the lock names exactly one archive. A URL that cannot be reached or whose
 * transfer breaks off falls through to the next; when none delivers, the download fails with
 * `network`.
 */
export async function downloadArchive(
  artifact: AddonArtifact,
  options: DownloadOptions,
): Promise<void> {
  const failures: string[] = [];
  for (const url of artifact.urls) {
    options.signal.throwIfAborted();
    let chunks: AsyncIterable<Uint8Array>;
    let stall: AbortController;
    try {
      ({ chunks, stall } = await openSource(url, artifact.size, options));
    } catch (error) {
      if (error instanceof AddonFailure && error.code === 'integrity') throw error;
      options.signal.throwIfAborted();
      failures.push(`${new URL(url).host || 'local file'}: ${errorMessage(error)}`);
      continue;
    }
    try {
      await receive(artifact, chunks, stall, options);
      return;
    } catch (error) {
      // An interrupted transfer tries the next URL from the start; anything else ends the install.
      if (!(error instanceof AddonFailure && error.code === 'network') || options.signal.aborted)
        throw error;
      failures.push(`${new URL(url).host || 'local file'}: ${error.message}`);
      await rm(options.file, { force: true });
    }
  }
  throw new AddonFailure('network', `The add-on could not be downloaded (${failures.join('; ')}).`);
}

/**
 * Opens one URL as a stream of chunks, with a stall timer the receiver re-arms per chunk. A
 * response that announces another length than the lock's is refused before any byte is read.
 */
async function openSource(
  url: string,
  size: number,
  options: DownloadOptions,
): Promise<{ chunks: AsyncIterable<Uint8Array>; stall: AbortController }> {
  const stall = new AbortController();
  const signal = AbortSignal.any([options.signal, stall.signal]);
  if (url.startsWith('file:')) {
    if (!options.development) throw new Error('file: URLs are only used in development.');
    const file = fileURLToPath(url);
    await access(file);
    return { chunks: createReadStream(file, { signal }), stall };
  }
  const timer = setTimeout(() => stall.abort(), STALL_MS);
  let response: Response;
  try {
    response = await fetch(url, { signal, headers: { accept: 'application/octet-stream' } });
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const announced = response.headers.get('content-length');
  if (announced !== null && Number(announced) !== size) {
    await response.body.cancel();
    throw new AddonFailure('integrity', 'The download has another size than this build expects.');
  }
  return { chunks: response.body, stall };
}

/** Streams chunks to `options.file`, counting and hashing them, and checks the result. */
async function receive(
  artifact: AddonArtifact,
  chunks: AsyncIterable<Uint8Array>,
  stall: AbortController,
  options: DownloadOptions,
): Promise<void> {
  const hash = createHash('sha256');
  const handle = await open(options.file, 'wx', 0o600);
  let received = 0;
  let timer = setTimeout(() => stall.abort(), STALL_MS);
  try {
    for await (const chunk of chunks) {
      clearTimeout(timer);
      received += chunk.byteLength;
      if (received > artifact.size)
        throw new AddonFailure('integrity', 'The download is larger than this build expects.');
      hash.update(chunk);
      await handle.write(chunk);
      options.onProgress(received);
      timer = setTimeout(() => stall.abort(), STALL_MS);
    }
  } catch (error) {
    if (error instanceof AddonFailure || options.signal.aborted) throw error;
    throw new AddonFailure(
      'network',
      stall.signal.aborted
        ? 'The download stalled.'
        : `The download was interrupted: ${errorMessage(error)}`,
    );
  } finally {
    clearTimeout(timer);
    await handle.close();
  }
  if (received !== artifact.size || hash.digest('hex') !== artifact.sha256)
    throw new AddonFailure('integrity', 'The download does not match the archive this build pins.');
}
