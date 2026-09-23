import { HomeIndexBackend } from './home-index';
import type { SearchScope } from './scope';
import { SpotlightBackend } from './spotlight';

/** A candidate file as a backend found it. `path` never leaves the main process. */
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
   * Aborts on a newer search from the same sender or at the time budget. The backend then stops
   * its work promptly and resolves with the hits it has as `partial`.
   */
  signal: AbortSignal;
}

export interface SearchBackend {
  /** The service filters, ranks and trims the hits, so a backend may return more than it shows. */
  search(request: SearchRequest): Promise<BackendReply>;
}

const unsupported: SearchBackend = {
  search: async () => ({ state: 'unavailable', reason: 'unsupported' }),
};

/**
 * macOS asks the system Spotlight index and never walks folders, so typing cannot raise privacy
 * prompts. Windows and Linux walk home into a cached in-memory index.
 */
export function platformBackend(platform: NodeJS.Platform): SearchBackend {
  switch (platform) {
    case 'darwin':
      return new SpotlightBackend();
    case 'win32':
    case 'linux':
      return new HomeIndexBackend(platform);
    default:
      return unsupported;
  }
}
