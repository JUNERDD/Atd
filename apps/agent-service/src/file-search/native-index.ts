import { access } from 'node:fs/promises';
import { errorMessage, SEARCHABLE_EXTENSIONS } from '@atd/agent-contracts';
import type { FileIndex, IndexStatus, QueryHit } from '@atd/file-index';
import { scrubPersonalPaths } from '../diagnostics/scrub-paths.js';
import type { Logger } from '../logging.js';
import type { BackendReply, SearchBackend, SearchHit, SearchRequest } from './backend.js';
import { IndexLifecycle, OpenFailed, type OpenFailure } from './index-lifecycle.js';

/** The parts of an open index a search uses. */
export type OpenIndex = Pick<FileIndex, 'query' | 'status' | 'close'>;

export interface NativeIndexLoadError {
  code: string | null;
  message: string;
  cause: string | null;
}

export interface NativeIndexDiagnostics {
  state: 'ready' | 'cold' | 'degraded' | 'unsupported';
  loadErrorCode: string | null;
  loadErrors: NativeIndexLoadError[];
}

type FileIndexModule = typeof import('@atd/file-index');

const MAX_LOAD_ERRORS = 8;
const MAX_ERROR_TEXT_CHARS = 256;

const loadFailuresByError = new WeakMap<
  object,
  { loadErrorCode: string; loadErrors: NativeIndexLoadError[] }
>();

let lastLoadDiagnostics: { loadErrorCode: string | null; loadErrors: NativeIndexLoadError[] } = {
  loadErrorCode: null,
  loadErrors: [],
};

function truncateScrubbed(value: string): string {
  const scrubbed = scrubPersonalPaths(value);
  return scrubbed.length > MAX_ERROR_TEXT_CHARS
    ? `${scrubbed.slice(0, MAX_ERROR_TEXT_CHARS - 1)}…`
    : scrubbed;
}

/**
 * Walks an error's `.cause` chain and `AggregateError.errors`, preserving structured
 * `{ code, message, cause }` entries scrubbed of personal directory paths.
 */
export function extractNativeIndexLoadErrors(error: unknown): NativeIndexLoadError[] {
  const out: NativeIndexLoadError[] = [];
  const seen = new Set<unknown>();
  const queue: unknown[] = [error];

  while (queue.length > 0 && out.length < MAX_LOAD_ERRORS) {
    const current = queue.shift();
    if (current === undefined || current === null || seen.has(current)) continue;
    seen.add(current);

    if (typeof current === 'object') {
      const record = current as {
        code?: unknown;
        message?: unknown;
        cause?: unknown;
        errors?: unknown;
      };
      const code = typeof record.code === 'string' && record.code ? record.code : null;
      const message = truncateScrubbed(
        typeof record.message === 'string' && record.message
          ? record.message
          : errorMessage(current),
      );
      const cause =
        record.cause !== undefined && record.cause !== null
          ? truncateScrubbed(errorMessage(record.cause))
          : null;
      out.push({ code, message, cause });
      if (record.cause !== undefined && record.cause !== null) queue.push(record.cause);
      if (Array.isArray(record.errors)) {
        for (const inner of record.errors) queue.push(inner);
      }
    } else {
      out.push({ code: null, message: truncateScrubbed(errorMessage(current)), cause: null });
    }
  }
  return out;
}

function classifyLoadErrorCode(loadErrors: readonly NativeIndexLoadError[]): string {
  for (const entry of loadErrors) {
    if (entry.code) {
      const normalized = entry.code.toLowerCase().replace(/[^a-z0-9_.-]+/g, '_');
      if (/^[a-z]/.test(normalized)) return normalized.slice(0, 64);
    }
    if (/EBADARCH|bad cpu type/i.test(entry.message)) return 'ebadarch';
    if (/ERR_DLOPEN_FAILED|dlopen/i.test(entry.message)) return 'err_dlopen_failed';
    if (/Cannot find module|MODULE_NOT_FOUND/i.test(entry.message)) return 'module_not_found';
  }
  return 'addon_load_failed';
}

/** Returns the most recent `@atd/file-index` addon load failure details (path-scrubbed). */
export function getLastNativeIndexLoadErrors(): {
  loadErrorCode: string | null;
  loadErrors: NativeIndexLoadError[];
} {
  return {
    loadErrorCode: lastLoadDiagnostics.loadErrorCode,
    loadErrors: lastLoadDiagnostics.loadErrors.map((entry) => ({ ...entry })),
  };
}

/** Resets cached addon load diagnostics; intended for unit tests. */
export function resetNativeIndexLoadErrorsForTests(): void {
  lastLoadDiagnostics = { loadErrorCode: null, loadErrors: [] };
}

/**
 * Verifies `@atd/file-index` native `.node` loading without opening an index or
 * walking the user's home directory (safe for static Doctor checks).
 */
export async function probeNativeIndexAddon(
  loadAddon: () => Promise<unknown> = () => import('@atd/file-index'),
): Promise<{ ok: boolean; loadErrorCode: string | null; loadErrors: NativeIndexLoadError[] }> {
  try {
    await loadAddon();
    lastLoadDiagnostics = { loadErrorCode: null, loadErrors: [] };
    return { ok: true, loadErrorCode: null, loadErrors: [] };
  } catch (error) {
    const loadErrors = extractNativeIndexLoadErrors(error);
    const loadErrorCode = classifyLoadErrorCode(loadErrors);
    lastLoadDiagnostics = { loadErrorCode, loadErrors };
    return {
      ok: false,
      loadErrorCode,
      loadErrors: loadErrors.map((entry) => ({ ...entry })),
    };
  }
}

/**
 * File names from the native index (`@atd/file-index`, `crates/file-index`): home and iCloud
 * Drive walked once, then kept current through FSEvents, with the index saved under the service
 * data dir so a restart resumes instead of walking again. The index ranks the files and marks
 * where the query matched each name; this backend passes both through unchanged.
 */
export class NativeIndexBackend implements SearchBackend {
  private readonly lifecycle: IndexLifecycle<OpenIndex>;
  /** The background failure last logged, so each one is logged once. */
  private reportedError: string | undefined;
  private diagnosticState: NativeIndexDiagnostics['state'] = 'cold';
  private loadErrorCode: string | null = null;
  private loadErrors: NativeIndexLoadError[] = [];

  /** `dataDir` is the index's own folder, created by the first open. */
  constructor(
    private readonly dataDir: string,
    private readonly log: Logger,
    open: (dataDir: string) => Promise<OpenIndex> = openNativeIndex,
  ) {
    this.lifecycle = new IndexLifecycle(async () => {
      try {
        const index = await open(dataDir);
        this.diagnosticState = 'ready';
        this.loadErrorCode = null;
        this.loadErrors = [];
        return index;
      } catch (error) {
        this.recordOpenFailure(error);
        throw error;
      }
    }, log);
  }

  /** Passive, side-effect-free diagnostic status (never triggers index open or home walk). */
  diagnosticsStatus(): NativeIndexDiagnostics {
    return {
      state: this.diagnosticState,
      loadErrorCode: this.loadErrorCode,
      loadErrors: this.loadErrors.map((entry) => ({ ...entry })),
    };
  }

  async search({ query, limit, signal }: SearchRequest): Promise<BackendReply> {
    let slot = this.lifecycle.current();
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

  close(): Promise<void> {
    return this.lifecycle.close();
  }

  private recordOpenFailure(error: unknown): void {
    const mapped =
      typeof error === 'object' && error !== null ? loadFailuresByError.get(error) : undefined;
    if (mapped) {
      this.loadErrorCode = mapped.loadErrorCode;
      this.loadErrors = mapped.loadErrors;
      this.diagnosticState = 'unsupported';
      this.log.warn('Failed to load @atd/file-index native addon.', {
        loadErrorCode: mapped.loadErrorCode,
        loadErrors: mapped.loadErrors,
      });
      return;
    }
    if (error instanceof OpenFailed) {
      this.loadErrorCode = error.failure.cause;
      this.loadErrors = extractNativeIndexLoadErrors(error);
      this.diagnosticState = error.failure.permanent ? 'unsupported' : 'degraded';
      return;
    }
    const extracted = extractNativeIndexLoadErrors(error);
    this.loadErrors = extracted;
    this.loadErrorCode = classifyLoadErrorCode(extracted);
    this.diagnosticState = 'degraded';
  }

  private stateOf(status: IndexStatus): Extract<BackendReply, { hits: SearchHit[] }>['state'] {
    if (status.error !== undefined) {
      const cause = causeOf(status.error);
      this.diagnosticState = 'degraded';
      this.loadErrorCode = cause;
      if (cause !== this.reportedError) {
        this.reportedError = cause;
        this.log.warn('The file index stopped keeping up with changes.', { cause });
      }
      return 'partial';
    }
    switch (status.phase) {
      case 'idle':
      case 'scanning':
        this.diagnosticState = 'ready';
        return 'indexing';
      case 'watching':
        this.diagnosticState = 'ready';
        return 'ok';
      case 'replaying':
      case 'failed':
      case 'stopped':
        this.diagnosticState = 'degraded';
        return 'partial';
    }
  }
}

/** Opens the index and starts its walk, or resumes from its saved event id. */
export async function openNativeIndex(
  dataDir: string,
  loadAddon: () => Promise<FileIndexModule> = () => import('@atd/file-index'),
): Promise<OpenIndex> {
  const addon = await loadAddon().catch((error: unknown) => {
    const loadErrors = extractNativeIndexLoadErrors(error);
    const loadErrorCode = classifyLoadErrorCode(loadErrors);
    lastLoadDiagnostics = { loadErrorCode, loadErrors };
    const failure = new OpenFailed({ stage: 'load', cause: loadErrorCode, permanent: true });
    loadFailuresByError.set(failure, { loadErrorCode, loadErrors });
    throw failure;
  });
  lastLoadDiagnostics = { loadErrorCode: null, loadErrors: [] };
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
