import type { Logger } from '../logging.js';
import { NativeIndexBackend } from './native-index.js';

/** `[from, to)` UTF-16 offsets into the NFC name, the text the renderer highlights. */
export type NameRange = readonly [from: number, to: number];

/** A file as the index ranked it. `path` never leaves the service. */
export interface SearchHit {
  /** The index's id for the path: the same file keeps it across queries and restarts. */
  id: string;
  /**
   * The file's real path. The index never follows links, so one file never appears under two
   * paths.
   */
  path: string;
  /** Basename, the text `matches` points into. */
  name: string;
  /** Bytes. */
  size: number | null;
  /** Epoch milliseconds. */
  modifiedAt: number | null;
  /**
   * Where the query matched `name`, sorted and non-overlapping; empty when only a folder matched
   * or the query was empty, and when the index reports no ranges.
   */
  matches: NameRange[];
}

/**
 * `indexing`: the index is opening or still walking for the first time, so the hits cover the
 * files found so far. `partial`: the search ran out of time, or the index stopped keeping up.
 * `retrying`: the index failed to open and the backend tries again on its own.
 */
export type BackendReply =
  | { state: 'ok' | 'partial' | 'indexing'; hits: SearchHit[] }
  | { state: 'unavailable'; reason: 'unsupported' | 'retrying' };

export interface SearchRequest {
  /** Trimmed; empty asks for recent files. */
  query: string;
  /** Hits wanted, best first; the index pays a `stat` per hit, so it stops there. */
  limit: number;
  /**
   * Aborts on a newer search on the same channel, at shutdown, or at the time budget. The backend
   * then stops its work promptly and resolves with what it has as `partial`, or as `indexing`
   * while the index is still opening.
   */
  signal: AbortSignal;
}

/**
 * Where file names come from. The index owns coverage and ranking; `FileSearchService` owns the
 * safety filter, result ids and attach, so a replacement index implements only this.
 */
export interface SearchBackend {
  /** Hits in the index's rank order; the service filters and trims them without reordering. */
  search(request: SearchRequest): Promise<BackendReply>;
  /**
   * Opens the index ahead of the first search when an earlier search left one on disk, so a
   * service restart resumes it in the background. A fresh data dir waits for a search.
   */
  warm(): Promise<void>;
  /**
   * Stops background work (the index's walk and event stream) at service shutdown. In-flight
   * searches are aborted through their signals first; the backend is not used again.
   */
  close(): Promise<void>;
}

const unsupported: SearchBackend = {
  search: async () => ({ state: 'unavailable', reason: 'unsupported' }),
  warm: async () => undefined,
  close: async () => undefined,
};

/**
 * macOS searches the native file-name index (`native-index.ts`), kept in `indexDir` under the
 * service data dir. Other platforms have no file search.
 */
export function platformBackend(
  platform: NodeJS.Platform,
  indexDir: string,
  log: Logger,
): SearchBackend {
  return platform === 'darwin' ? new NativeIndexBackend(indexDir, log) : unsupported;
}
