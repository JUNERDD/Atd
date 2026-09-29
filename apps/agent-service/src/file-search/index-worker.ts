import { parentPort, workerData } from 'node:worker_threads';
import type { FileIndex } from '@ai/file-index';

/** What the backend passes as `workerData`. */
export interface WorkerInit {
  /** The index's own folder under the service data dir. */
  dataDir: string;
  /** Attachable extensions without dots; a different list rebuilds the index. */
  extensions: string[];
}

export type WorkerRequest =
  | { type: 'query'; id: number; text: string; limit: number }
  | { type: 'close' };

/** A file the index matched. `path` stays in the service, like every backend's hit paths. */
export interface IndexHit {
  path: string;
  size: number | null;
  modifiedAt: number | null;
}

export type WorkerReply =
  /** `scanning` while the first walk runs: the hits cover the files found so far. */
  | { type: 'query'; id: number; hits: IndexHit[]; scanning: boolean }
  /** The addon or the index could not be opened; the backend stops asking. */
  | { type: 'unavailable'; id: number }
  /** This query failed; the index stays open for the next one. */
  | { type: 'failed'; id: number }
  | { type: 'closed' };

/**
 * Owns the native `FileIndex`: every call into it is synchronous (a query stats its hits), so it
 * runs here instead of on the service's event loop. The index opens on the first query, starts
 * its walk or resumes from its saved event id, and closes on `close` so the resume point is saved.
 * Failures carry no message to the parent: native errors can name paths.
 */
const port = parentPort;
if (!port) throw new Error('index-worker runs as a worker thread only.');
const init = workerData as WorkerInit;
let opening: Promise<FileIndex | null> | null = null;

async function open(): Promise<FileIndex | null> {
  try {
    const { FileIndex } = await import('@ai/file-index');
    const index = FileIndex.open(init.dataDir, { extensions: init.extensions });
    index.start();
    return index;
  } catch {
    return null;
  }
}

async function handle(request: WorkerRequest): Promise<WorkerReply> {
  if (request.type === 'close') {
    // Never opened: nothing to save, and opening now would start a walk.
    (await opening)?.close();
    return { type: 'closed' };
  }
  opening ??= open();
  const index = await opening;
  if (!index) return { type: 'unavailable', id: request.id };
  try {
    const hits = index.query(request.text, request.limit).map((hit) => ({
      path: hit.path,
      size: hit.size ?? null,
      modifiedAt: hit.modifiedAt ?? null,
    }));
    return { type: 'query', id: request.id, hits, scanning: index.status().phase === 'scanning' };
  } catch {
    return { type: 'failed', id: request.id };
  }
}

// Requests run one at a time, in order, so `close` always follows the queries sent before it.
let queue = Promise.resolve();
port.on('message', (request: WorkerRequest) => {
  queue = queue.then(async () => {
    const reply = await handle(request);
    port.postMessage(reply);
    if (reply.type === 'closed') port.close();
  });
});
