import { ATTACHABLE_EXTENSIONS } from '@ai/agent-contracts';
import type { FileIndex } from '@ai/file-index';
import type { BackendReply, SearchBackend, SearchHit, SearchRequest } from './backend.js';
import { foldText } from './rank.js';

/**
 * Hits asked of the index per query, its maximum. The service re-ranks them and sorts files over
 * the attachment size limit last, so it needs more than the rows it shows to fill them.
 */
const QUERY_LIMIT = 100;
/** How long `close` waits for the index to save its resume point before shutdown goes on. */
const CLOSE_TIMEOUT_MS = 5000;

/**
 * File names from the native index (`@ai/file-index`, `crates/file-index`): home and iCloud
 * Drive walked once, then kept current through FSEvents, with the index saved under the service
 * data dir so a restart resumes instead of walking again.
 *
 * Every blocking call into the addon (opening, a query that stats its hits, closing) is a promise
 * that runs on libuv's thread pool, so none of them stalls the service's event loop. Aborting a
 * search cancels its query while it is still queued.
 *
 * The index keeps no "last used" date (Spotlight's `kMDItemLastUsedDate`), so every hit reports
 * `usedAt: null` and ranking orders by modification time: recent files are recently modified
 * ones, and opened-but-unchanged files no longer rise to the top. Mid-word matches come from the
 * index's in-memory name list when word matches do not fill the reply.
 */
export class NativeIndexBackend implements SearchBackend {
  /** Set by the first search; resolves null when the addon or the index cannot be opened. */
  private opening: Promise<FileIndex | null> | null = null;
  private closed = false;

  /** `dataDir` is the index's own folder, created on first use. */
  constructor(private readonly dataDir: string) {}

  async search({ query, signal }: SearchRequest): Promise<BackendReply> {
    if (this.closed || signal.aborted) return { state: 'partial', hits: [] };
    this.opening ??= this.open();
    const index = await untilAborted(this.opening, signal);
    if (index === undefined || signal.aborted) return { state: 'partial', hits: [] };
    if (index === null) return { state: 'unavailable', reason: 'unsupported' };
    try {
      const found = await index.query(query, QUERY_LIMIT, signal);
      const source: SearchHit['source'] =
        Array.from(foldText(query)).length <= 1 ? 'recent' : 'search';
      const hits = found.map((hit) => ({
        path: hit.path,
        size: hit.size ?? null,
        modifiedAt: hit.modifiedAt ?? null,
        usedAt: null,
        source,
      }));
      // The first walk is still running: the hits cover the files found so far.
      return { state: index.status().phase === 'scanning' ? 'partial' : 'ok', hits };
    } catch {
      if (signal.aborted) return { state: 'partial', hits: [] };
      // Native errors can name paths, so none of the message travels on.
      throw new Error('The file index could not answer.');
    }
  }

  /** Lets the index save its resume point; shutdown does not wait longer than the timeout. */
  async close(): Promise<void> {
    this.closed = true;
    // Never opened: nothing to save, and opening now would start a walk.
    const index = await this.opening;
    if (!index) return;
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, CLOSE_TIMEOUT_MS).unref());
    await Promise.race([index.close().catch(() => undefined), timeout]);
  }

  /** Opens the index and starts its walk, or resumes from its saved event id. */
  private async open(): Promise<FileIndex | null> {
    try {
      const { FileIndex } = await import('@ai/file-index');
      const index = await FileIndex.open(this.dataDir, { extensions: [...ATTACHABLE_EXTENSIONS] });
      try {
        index.start();
      } catch (error) {
        await index.close().catch(() => undefined);
        throw error;
      }
      return index;
    } catch {
      return null;
    }
  }
}

/** The promise's value, or `undefined` as soon as the signal aborts. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const abort = () => resolve(undefined);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
