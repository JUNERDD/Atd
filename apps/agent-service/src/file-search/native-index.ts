import { access } from 'node:fs/promises';
import { SEARCHABLE_EXTENSIONS } from '@atd/agent-contracts';
import type { FileIndex, IndexStatus, QueryHit } from '@atd/file-index';
import type { Logger } from '../logging.js';
import type { BackendReply, SearchBackend, SearchHit, SearchRequest } from './backend.js';
import { IndexLifecycle, OpenFailed, type OpenFailure } from './index-lifecycle.js';

/** The parts of an open index a search uses. */
export type OpenIndex = Pick<FileIndex, 'query' | 'status' | 'close'>;

/**
 * File names from the native index (`@atd/file-index`, `crates/file-index`): home and iCloud
 * Drive walked once, then kept current through FSEvents, with the index saved under the service
 * data dir so a restart resumes instead of walking again. The index ranks the files and marks
 * where the query matched each name; this backend passes both through unchanged.
 *
 * Every blocking call into the addon (opening, a query that stats its hits, closing) is a promise
 * that runs on libuv's thread pool, so none of them stalls the service's event loop. Aborting a
 * search cancels its query while it is still queued.
 */
export class NativeIndexBackend implements SearchBackend {
  private readonly lifecycle: IndexLifecycle<OpenIndex>;
  /** The background failure last logged, so each one is logged once. */
  private reportedError: string | undefined;

  /** `dataDir` is the index's own folder, created by the first open. */
  constructor(
    private readonly dataDir: string,
    private readonly log: Logger,
    open: (dataDir: string) => Promise<OpenIndex> = openNativeIndex,
  ) {
    this.lifecycle = new IndexLifecycle(() => open(dataDir), log);
  }

  async search({ query, limit, signal }: SearchRequest): Promise<BackendReply> {
    let slot = this.lifecycle.current();
    // Within the search's budget, a search that arrives while the index opens waits for it; the
    // lifecycle then says how the open went.
    if (slot.kind === 'opening') {
      const opened = await untilAborted(slot.ready, signal);
      if (opened === undefined) return { state: 'indexing', hits: [] };
      slot = this.lifecycle.current();
    }
    if (slot.kind === 'unsupported') return { state: 'unavailable', reason: 'unsupported' };
    if (slot.kind === 'retrying') return { state: 'unavailable', reason: 'retrying' };
    if (slot.kind !== 'open' || signal.aborted) return { state: 'partial', hits: [] };
    const { index } = slot;
    try {
      const found = await index.query(query, limit, signal);
      return { state: this.stateOf(index.status()), hits: found.map(hitOf) };
    } catch {
      if (signal.aborted) return { state: 'partial', hits: [] };
      // Native errors can name paths, so none of the message travels on.
      throw new Error('The file index could not answer.');
    }
  }

  /**
   * Resumes an index an earlier search created; the folder only exists once one did. A fresh
   * data dir starts nothing, so no walk of the home folder begins before anyone searches.
   */
  async warm(): Promise<void> {
    const exists = await access(this.dataDir).then(
      () => true,
      () => false,
    );
    if (exists) this.lifecycle.start();
  }

  /**
   * Lets the index save its resume point; shutdown waits for neither a pending open nor the close
   * longer than the lifecycle's deadline. A close that outlasts it still occupies a libuv pool
   * thread, which process exit then waits for, so the native supervisor ends that process
   * (`ServiceStopper.ensureExit`).
   */
  close(): Promise<void> {
    return this.lifecycle.close();
  }

  /**
   * How complete the hits are. A background failure leaves the index short of later changes until
   * the next service start rebuilds it, so its replies say results may be missing.
   */
  private stateOf(status: IndexStatus): Extract<BackendReply, { hits: SearchHit[] }>['state'] {
    if (status.error !== undefined) {
      const cause = causeOf(status.error);
      if (cause !== this.reportedError) {
        this.reportedError = cause;
        this.log.warn('The file index stopped keeping up with changes.', { cause });
      }
      return 'partial';
    }
    switch (status.phase) {
      case 'idle':
      case 'scanning':
        return 'indexing';
      case 'watching':
        return 'ok';
      // A resumed index holds every file but the changes made while the service was not
      // running, which it is still catching up on.
      case 'replaying':
      case 'failed':
      case 'stopped':
        return 'partial';
    }
  }
}

/** Opens the index and starts its walk, or resumes from its saved event id. */
async function openNativeIndex(dataDir: string): Promise<OpenIndex> {
  const addon = await import('@atd/file-index').catch(() => {
    // The addon is missing or built for another architecture: retrying cannot help.
    throw new OpenFailed({ stage: 'load', cause: 'addon', permanent: true });
  });
  const index = await addon.FileIndex.open(dataDir, {
    extensions: [...SEARCHABLE_EXTENSIONS],
  }).catch((error: unknown) => {
    throw new OpenFailed(failureOf('open', error));
  });
  try {
    index.start();
  } catch (error) {
    await index.close().catch(() => undefined);
    throw new OpenFailed(failureOf('start', error));
  }
  return index;
}

/**
 * Options the index refuses (no local root, such as a home folder on an external disk) stay
 * refused, so they are not retried; every other failure may pass, such as a lock the previous
 * service still holds while it closes.
 */
function failureOf(stage: OpenFailure['stage'], error: unknown): OpenFailure {
  const cause = causeOf(error instanceof Error ? error.message : String(error));
  return { stage, cause, permanent: cause === 'options' };
}

/** Prefixes of the index's error messages (`crates/file-index/src/lib.rs`, `Error`). */
const CAUSES: ReadonlyArray<readonly [prefix: string, cause: string]> = [
  ['invalid index options', 'options'],
  ['index store failed', 'store'],
  ['file-system events failed', 'events'],
  ['internal error', 'internal'],
  ['the index is closed', 'closed'],
];

/** A path-free category for an index error message: its kind, or the OS error number. */
function causeOf(message: string): string {
  const known = CAUSES.find(([prefix]) => message.startsWith(prefix));
  if (known) return known[1];
  const code = /\(os error (\d+)\)/.exec(message)?.[1];
  return code ? `os-${code}` : 'unknown';
}

/**
 * The hit fields the service reads, with the match ranges of contract C2 (`QueryHit.matches`).
 * An addon built before those ranges existed reports none, so its names show without a highlight.
 */
type RankedHit = Pick<QueryHit, 'id' | 'path' | 'name' | 'size' | 'modifiedAt'> & {
  matches?: ReadonlyArray<{ from: number; to: number }>;
};

function hitOf(hit: RankedHit): SearchHit {
  return {
    id: hit.id,
    path: hit.path,
    name: hit.name,
    size: hit.size ?? null,
    modifiedAt: hit.modifiedAt ?? null,
    matches: hit.matches?.map(({ from, to }) => [from, to] as const) ?? [],
  };
}

/** The promise's value, or `undefined` as soon as the signal aborts. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const abort = () => resolve(undefined);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
