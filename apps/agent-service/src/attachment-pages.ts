import { Worker } from 'node:worker_threads';
import { resizeImage } from '@earendil-works/pi-coding-agent';
import { errorMessage } from '@atd/agent-contracts';
import type { PagesReply, PagesRequest } from './attachment-pages-worker.js';
import type { LoadedFile } from './file-loader/loader.js';
import type { Logger } from './logging.js';
import type { RunImageAttachment } from './run-material.js';

type LoadedImage = Extract<LoadedFile, { kind: 'image' }>;
/** How a page is scaled and encoded for the model: the run's ingest size (run-attachments.ts). */
type Ingest = NonNullable<Parameters<typeof resizeImage>[2]> & { maxWidth: number };

/** The worker entry beside this module, in `dist/` as in `src/`. */
const WORKER_ENTRY = new URL('./attachment-pages-worker.js', import.meta.url);

/** Images at least this many times taller than wide are read as pages. */
const MIN_ASPECT = 2;
/** A tall image is read as this many pages at most. */
const MAX_PAGES = 8;

/**
 * The pages a tall image is read as: `[top, bottom)` pixel rows, top to bottom; one page for an
 * image less than `MIN_ASPECT` times taller than wide. Its width is scaled within `edge` (the
 * ingest edge) and it is cut into at most `MAX_PAGES` equal pages, each within `edge` pixels tall
 * at that scale; the ingest scaling then shrinks the pages further only when more would be
 * needed. This is the rule the shell states as `LongScreenshotPages`
 * (apps/macos/Sources/AICore/LongScreenshot/LongScreenshotContracts.swift), so a long screenshot's
 * result card shows the pages the model reads: both must give the same rows.
 */
export function pageRows(width: number, height: number, edge: number): Array<[number, number]> {
  if (width <= 0 || height <= 0) return [];
  if (height < width * MIN_ASPECT) return [[0, height]];
  const scale = Math.min(1, edge / width);
  const count = Math.min(MAX_PAGES, Math.max(1, Math.ceil((height * scale) / edge)));
  return Array.from({ length: count }, (_, index) => [
    Math.floor((height * index) / count),
    Math.floor((height * (index + 1)) / count),
  ]);
}

/** What reading a tall image as pages reports to, and ends with (`signal`). */
export interface PagesContext {
  log: Logger;
  taskId: string;
  signal?: AbortSignal;
}

/**
 * A tall image read as its pages (`pageRows`), each its own image input within `ingest`'s size
 * and byte budget, named after the file with its number, its note saying which rows of the
 * `size` image it shows. The worker scales each page within the ingest edge; Pi's scaling then
 * applies the byte budget, which may shrink a page further. A long screenshot scaled whole to the ingest size
 * would leave its text unreadable. Null when the image is not tall, and when it could not be cut
 * (then logged), so it is read whole like any other image. Rejects with `signal`'s reason once it
 * aborts.
 */
export async function imagePages(
  entry: { name: string; path: string },
  loaded: LoadedImage,
  size: { width: number; height: number },
  ingest: Ingest,
  { log, taskId, signal }: PagesContext,
): Promise<RunImageAttachment[] | null> {
  const rows = pageRows(size.width, size.height, ingest.maxWidth);
  if (rows.length < 2) return null;
  const unpaged = (reason: string) => {
    log.warn('Tall image not read as pages; reading it whole.', { taskId, error: reason });
    return null;
  };
  let pages: Uint8Array[] | null;
  try {
    pages = await cutPages({ bytes: loaded.bytes, ...size, rows, edge: ingest.maxWidth }, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
    return unpaged(errorMessage(error));
  }
  if (!pages) return unpaged('it decodes at another size than it declares');
  const attachments: RunImageAttachment[] = [];
  for (const [index, [top, bottom]] of rows.entries()) {
    signal?.throwIfAborted();
    const page = pages[index];
    const resized = page ? await resizeImage(page, 'image/png', ingest) : null;
    if (!resized) return unpaged(`page ${index + 1} could not be scaled`);
    const number = `${index + 1} of ${rows.length}`;
    // Pi's dimension note would map to the page as the worker scaled it, not to the image.
    const factor = (size.width / resized.width).toFixed(2);
    const where = `[Page ${number} of a tall image of ${size.width}x${size.height}, read top to bottom: its rows ${top} to ${bottom - 1}, displayed at ${resized.width}x${resized.height}. Multiply coordinates by ${factor} and add ${top} to y to map to the whole image.]`;
    attachments.push({
      kind: 'image',
      name: `${entry.name} (page ${number})`,
      path: entry.path,
      image: { type: 'image', data: resized.data, mimeType: resized.mimeType },
      note: where,
    });
  }
  return attachments;
}

/** The pages of `request` as PNGs, cut and scaled in a worker (attachment-pages-worker.ts). */
function cutPages(request: PagesRequest, signal?: AbortSignal): Promise<Uint8Array[] | null> {
  signal?.throwIfAborted();
  const worker = new Worker(WORKER_ENTRY);
  let abort = () => {};
  return new Promise<Uint8Array[] | null>((resolve, reject) => {
    abort = () => reject(signal?.reason);
    signal?.addEventListener('abort', abort, { once: true });
    worker.on('message', (message: unknown) => {
      // Node can post its own messages on the channel (`node --watch`); only the reply counts.
      if (!isReply(message)) return;
      if ('error' in message) reject(new Error(message.error));
      else resolve(message.pages);
    });
    worker.once('error', reject);
    worker.once('exit', (code) => reject(new Error(`The page worker exited with code ${code}.`)));
    worker.postMessage(request);
  }).finally(() => {
    signal?.removeEventListener('abort', abort);
    void worker.terminate().catch(() => undefined);
  });
}

function isReply(message: unknown): message is PagesReply {
  return (
    typeof message === 'object' && message !== null && ('pages' in message || 'error' in message)
  );
}
