import { Worker } from 'node:worker_threads';
import {
  failureReason,
  parseOutcome,
  parsePdfPagesReply,
  type ExtractJob,
  type ExtractOutcome,
  type PdfPagesReply,
  type WorkerJob,
} from './jobs.js';
import type { PdfText, PdfTextOptions } from './pdf-text.js';

/** The worker entry beside this module, in `dist/file-loader/` as in `src/file-loader/`. */
const WORKER_ENTRY = new URL('./worker.js', import.meta.url);

const MIB = 1024 * 1024;

/** How long one extraction may run, counted from its worker's start, before it is terminated. */
export const EXTRACT_TIMEOUT_MS = 30_000;

/**
 * Memory one extraction may use: its worker's V8 heap plus the memory its objects hold outside
 * that heap (ArrayBuffers such as inflated parts and decoded streams). The heap cap bounds only
 * the first, so a watchdog samples both every `MEMORY_POLL_MS` and terminates the worker past
 * the budget. The largest workbook `ZIP_LIMITS` (zip.ts) admits, 256 MB of sheet XML, peaks near
 * 930 MB.
 */
const MEMORY_BUDGET_MB = 1024;
const MEMORY_POLL_MS = 100;
const OVER_BUDGET = `it needs more than ${MEMORY_BUDGET_MB} MB of memory`;

/** Extraction workers alive at once in the whole service; further jobs wait for a slot. */
const MAX_WORKERS = 2;

/**
 * Runs one extraction job. Resolves with the outcome, also when the worker fails or times out;
 * rejects only with `signal`'s reason once it aborts.
 */
export type Extract = (job: ExtractJob, signal?: AbortSignal) => Promise<ExtractOutcome>;

/** Worker slots shared by every extraction, granted in request order. */
class Slots {
  private running = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly size: number) {}

  /** Resolves with the slot's release once one is free; rejects when `signal` aborts first. */
  acquire(signal?: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener('abort', abort);
        this.running += 1;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          this.running -= 1;
          this.waiting.shift()?.();
        });
      };
      const abort = () => {
        const index = this.waiting.indexOf(grant);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(signal?.reason);
      };
      if (signal?.aborted) reject(signal.reason);
      else if (this.running < this.size) grant();
      else {
        this.waiting.push(grant);
        signal?.addEventListener('abort', abort, { once: true });
      }
    });
  }
}

const slots = new Slots(MAX_WORKERS);

/** A worker's one message, or why it sent none. */
type Settled = { message: unknown } | { reason: string };

/**
 * Extracts in a fresh worker thread per job: the parsers are synchronous and may meet hostile
 * input, so they run off the service's event loop, at most `MAX_WORKERS` at a time, each within
 * `MEMORY_BUDGET_MB` of memory. A worker is terminated once it answers, fails, outlives
 * `timeoutMs` or `signal` aborts.
 */
export function workerExtract(timeoutMs = EXTRACT_TIMEOUT_MS): Extract {
  return async (job, signal) => {
    const settled = await inWorker(job, timeoutMs, signal);
    if ('reason' in settled) return { status: 'failed', reason: settled.reason };
    return parseOutcome(settled.message);
  };
}

/**
 * Reads a PDF's pages within `limits`. Resolves with them or why there are none, also when the
 * worker fails or times out; rejects only with `signal`'s reason once it aborts.
 */
export type ExtractPdfPages = (
  bytes: Uint8Array,
  limits: PdfTextOptions,
  signal?: AbortSignal,
) => Promise<PdfPagesReply>;

/** Reads PDF pages in an extraction worker, as `workerExtract` extracts documents. */
export function workerPdfPages(timeoutMs = EXTRACT_TIMEOUT_MS): ExtractPdfPages {
  return async (bytes, limits, signal) => {
    const settled = await inWorker({ kind: 'pdf-pages', bytes, ...limits }, timeoutMs, signal);
    if ('reason' in settled) return { status: 'failed', reason: settled.reason };
    return parsePdfPagesReply(settled.message);
  };
}

/**
 * The text of a PDF's first `maxPages` pages, read in an extraction worker. Throws with why the
 * PDF could not be read; rejects with `signal`'s reason once it aborts.
 */
export async function workerPdfText(
  bytes: Uint8Array,
  maxPages: number,
  signal?: AbortSignal,
): Promise<PdfText> {
  const reply = await workerPdfPages()(bytes, { maxPages }, signal);
  switch (reply.status) {
    case 'pages':
      return { pageCount: reply.pageCount, pages: reply.pages, title: reply.title };
    case 'protected':
      throw new Error('The PDF is password protected.');
    case 'failed':
      throw new Error(`The PDF could not be read: ${reply.reason}.`);
  }
}

async function inWorker(job: WorkerJob, timeoutMs: number, signal?: AbortSignal): Promise<Settled> {
  const release = await slots.acquire(signal);
  if (signal?.aborted) {
    release();
    throw signal.reason;
  }
  let worker: Worker;
  try {
    worker = new Worker(WORKER_ENTRY, {
      // The service's own Node flags never reach a parser (some, like --input-type, make a
      // file-based worker refuse to start).
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: MEMORY_BUDGET_MB },
      // A parser's console output (pdf.js warnings) stays out of the service's log.
      stdout: true,
      stderr: true,
    });
  } catch (error) {
    release();
    return { reason: failureReason(error) };
  }
  return supervise(worker, job, timeoutMs, signal, release);
}

/**
 * Hands `job` to `worker` and settles on its first message, failure, timeout, memory overrun or
 * abort. The slot is released once the thread is gone, so no more than `MAX_WORKERS` threads
 * hold memory at once.
 */
function supervise(
  worker: Worker,
  job: WorkerJob,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  release: () => void,
): Promise<Settled> {
  return new Promise<Settled>((resolve, reject) => {
    worker.stdout.resume();
    worker.stderr.resume();
    let settled = false;
    const settle = (finish: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(watchdog);
      signal?.removeEventListener('abort', abort);
      void worker.terminate().then(release, release);
      finish();
    };
    const fail = (reason: string) => settle(() => resolve({ reason }));
    const abort = () => settle(() => reject(signal?.reason));
    const timer = setTimeout(
      () => fail(`it took longer than ${Math.round(timeoutMs / 1000)} seconds`),
      timeoutMs,
    );
    let sampling = false;
    // The worker answers between two steps of synchronous parsing too (V8 interrupts it).
    const watchdog = setInterval(() => {
      if (sampling) return;
      sampling = true;
      void worker.getHeapStatistics().then(
        ({ used_heap_size: heap, external_memory: external }) => {
          sampling = false;
          if (heap + external > MEMORY_BUDGET_MB * MIB) fail(OVER_BUDGET);
        },
        () => {
          sampling = false;
        },
      );
    }, MEMORY_POLL_MS);
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', (message: unknown) => settle(() => resolve({ message })));
    worker.once('error', (error) => fail(workerFailure(error)));
    worker.once('exit', (code) => fail(`the extractor stopped (exit code ${code})`));
    try {
      const [message, transfer] = payload(job);
      worker.postMessage(message, transfer);
    } catch (error) {
      fail(failureReason(error));
    }
  });
}

/**
 * The job with its bytes copied into a fresh ArrayBuffer the worker takes over. The caller's
 * bytes stay intact: they may be a view into a larger or pooled buffer that cannot move.
 */
function payload(job: WorkerJob): [WorkerJob, ArrayBuffer[]] {
  if (!('bytes' in job)) return [job, []];
  const bytes = new Uint8Array(job.bytes.byteLength);
  bytes.set(job.bytes);
  return [{ ...job, bytes }, [bytes.buffer]];
}

function workerFailure(error: Error): string {
  if ('code' in error && error.code === 'ERR_WORKER_OUT_OF_MEMORY') return OVER_BUDGET;
  return failureReason(error);
}
