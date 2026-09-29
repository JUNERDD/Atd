import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { ATTACHABLE_EXTENSIONS } from '@ai/agent-contracts';
import type { BackendReply, SearchBackend, SearchHit, SearchRequest } from './backend.js';
import type { WorkerInit, WorkerReply, WorkerRequest } from './index-worker.js';
import { foldText } from './rank.js';

/**
 * Hits asked of the index per query, its maximum. The service re-ranks them and sorts files over
 * the attachment size limit last, so it needs more than the rows it shows to fill them.
 */
const QUERY_LIMIT = 100;
/** Worker crashes tolerated before search reports itself unavailable until the service restarts. */
const MAX_CRASHES = 3;
/** How long `close` waits for the index to save its resume point before stopping the worker. */
const CLOSE_TIMEOUT_MS = 5000;
/** The worker module next to this one: `.js` when built, `.ts` when run from source. */
const WORKER_URL = new URL(`./index-worker${path.extname(import.meta.url)}`, import.meta.url);

type QueryReply = Exclude<WorkerReply, { type: 'closed' }>;

interface Pending {
  resolve: (reply: QueryReply) => void;
  reject: (error: Error) => void;
}

/**
 * File names from the native index (`@ai/file-index`, `crates/file-index`) running in a worker
 * thread: home and iCloud Drive walked once, then kept current through FSEvents, with the index
 * saved under the service data dir so a restart resumes instead of walking again.
 *
 * The index keeps no "last used" date (Spotlight's `kMDItemLastUsedDate`), so every hit reports
 * `usedAt: null` and ranking orders by modification time: recent files are recently modified
 * ones, and opened-but-unchanged files no longer rise to the top. Mid-word matches come from the
 * index's in-memory name list when word matches do not fill the reply.
 *
 * A worker that crashes fails its in-flight searches (the client shows a failed search) and is
 * started again by the next search; the service itself keeps running.
 */
export class NativeIndexBackend implements SearchBackend {
  private worker: Worker | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 0;
  private crashes = 0;
  private unavailable = false;

  /** `dataDir` is the index's own folder, created on first use. */
  constructor(private readonly dataDir: string) {}

  async search({ query, signal }: SearchRequest): Promise<BackendReply> {
    if (this.unavailable || this.crashes >= MAX_CRASHES)
      return { state: 'unavailable', reason: 'unsupported' };
    if (signal.aborted) return { state: 'partial', hits: [] };
    const reply = await this.ask(query, signal);
    if (reply === null) return { state: 'partial', hits: [] };
    switch (reply.type) {
      case 'unavailable':
        this.unavailable = true;
        return { state: 'unavailable', reason: 'unsupported' };
      case 'failed':
        throw new Error('The file index could not answer.');
      case 'query': {
        const source: SearchHit['source'] = [...foldText(query)].length <= 1 ? 'recent' : 'search';
        const hits = reply.hits.map((hit) => ({ ...hit, usedAt: null, source }));
        return { state: reply.scanning ? 'partial' : 'ok', hits };
      }
    }
  }

  /** Lets the index save its resume point, then stops the worker. */
  async close(): Promise<void> {
    const worker = this.worker;
    if (!worker) return;
    this.worker = null;
    const exited = new Promise<void>((resolve) => worker.once('exit', () => resolve()));
    worker.postMessage({ type: 'close' } satisfies WorkerRequest);
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS).unref());
    await Promise.race([exited, timeout]);
    await worker.terminate();
  }

  /** Resolves null when the signal aborts first; rejects when the worker stops. */
  private ask(text: string, signal: AbortSignal): Promise<QueryReply | null> {
    const worker = this.spawn();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(id);
        resolve(null);
      };
      signal.addEventListener('abort', abort, { once: true });
      const settle = () => signal.removeEventListener('abort', abort);
      this.pending.set(id, {
        resolve: (reply) => {
          settle();
          resolve(reply);
        },
        reject: (error) => {
          settle();
          reject(error);
        },
      });
      worker.postMessage({ type: 'query', id, text, limit: QUERY_LIMIT } satisfies WorkerRequest);
    });
  }

  private spawn(): Worker {
    if (this.worker) return this.worker;
    const init: WorkerInit = { dataDir: this.dataDir, extensions: [...ATTACHABLE_EXTENSIONS] };
    const worker = new Worker(WORKER_URL, { workerData: init });
    worker.on('message', (reply: WorkerReply) => {
      if (reply.type === 'closed') return;
      const pending = this.pending.get(reply.id);
      this.pending.delete(reply.id);
      pending?.resolve(reply);
    });
    // Neither handler rethrows: a failed worker must not take the service down.
    worker.on('error', () => this.lost(worker));
    worker.on('exit', () => this.lost(worker));
    this.worker = worker;
    return worker;
  }

  /** The worker stopped on its own (a closing worker is no longer `this.worker`). */
  private lost(worker: Worker): void {
    if (this.worker !== worker) return;
    this.worker = null;
    this.crashes += 1;
    for (const pending of this.pending.values())
      pending.reject(new Error('The file index worker stopped.'));
    this.pending.clear();
  }
}
