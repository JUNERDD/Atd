import { NativeIndexBackend } from './native-index.js';
import type { SearchScope } from './scope.js';

/** A candidate file as a backend found it. `path` never leaves the service. */
export interface SearchHit {
  /**
   * The file's real path. Backends resolve links or skip them, so one file never appears under
   * two paths and de-duplication can compare paths directly.
   */
  path: string;
  /** Bytes. */
  size: number | null;
  /** Epoch milliseconds. */
  modifiedAt: number | null;
  /** Epoch milliseconds. */
  usedAt: number | null;
  source: 'recent' | 'search';
}

export type BackendReply =
  | { state: 'ok' | 'partial'; hits: SearchHit[] }
  | { state: 'unavailable'; reason: 'indexDisabled' | 'unsupported' };

export interface SearchRequest {
  /** Trimmed; empty asks for recent files. */
  query: string;
  /** Results the reply can show; a backend that pays per result (stat) stops there. */
  limit: number;
  scope: SearchScope;
  /**
   * Aborts on a newer search on the same channel, at shutdown, or at the time budget. The backend
   * then stops its work promptly and resolves with the hits it has as `partial`.
   */
  signal: AbortSignal;
}

/**
 * Where file names come from. `FileSearchService` owns the scope, ranking, result ids and
 * attach, so a replacement index (the native file index) implements only this.
 */
export interface SearchBackend {
  /** The service filters, ranks and trims the hits, so a backend may return more than it shows. */
  search(request: SearchRequest): Promise<BackendReply>;
  /**
   * Stops background work (the index's walk and event stream) at service shutdown. In-flight searches are
   * aborted through their signals first; the backend is not used again.
   */
  close(): Promise<void>;
}

const unsupported: SearchBackend = {
  search: async () => ({ state: 'unavailable', reason: 'unsupported' }),
  close: async () => undefined,
};

/**
 * macOS searches the native file-name index (`native-index.ts`), kept in `indexDir` under the
 * service data dir. Other platforms have no file search.
 */
export function platformBackend(platform: NodeJS.Platform, indexDir: string): SearchBackend {
  return platform === 'darwin' ? new NativeIndexBackend(indexDir) : unsupported;
}
