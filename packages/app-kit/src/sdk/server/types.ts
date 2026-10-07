import type { DatabaseSync } from 'node:sqlite';
import type {
  AgentRunChunk,
  AgentRunInput,
  AgentRunOutput,
  AiGenerateInput,
  AiGenerateOutput,
  AiStreamChunk,
  AppCapabilityOpInput,
  AppCapabilityOpName,
  AppCapabilityOpOutput,
} from '../../contracts.ts';
import type { WidgetDefinition } from './widgets.ts';

/*
 * The backend context. `runtime/context.mjs` implements it inside the sandboxed child; app code
 * only sees these types, so the runtime (shipped with the service) can evolve without rebuilding
 * published app versions. Capability inputs and outputs are the service's capability operations
 * (`@atd/agent-contracts` `APP_CAPABILITY_OPS`).
 */

/**
 * A streamed response: iterate it for chunks; `result` settles with the final value (and rejects
 * when the request fails). Leaving the loop early or calling `cancel` stops it.
 */
export interface StreamHandle<Chunk, Result> extends AsyncIterable<Chunk> {
  readonly result: Promise<Result>;
  cancel(): void;
}

/** A capability operation that answers once. */
type Op<N extends AppCapabilityOpName> = (
  input: AppCapabilityOpInput<N>,
) => Promise<AppCapabilityOpOutput<N>>;

/** A small JSON key-value store in the app's data directory (`kv.db`). */
export interface KeyValueStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): boolean;
  keys(prefix?: string): string[];
}

export interface FileEntry {
  name: string;
  isDirectory: boolean;
  size: number;
}
/** Files under `<dataDir>/files`; paths are relative to it and may not leave it. */
export interface AppFiles {
  read(path: string): Uint8Array;
  readText(path: string): string;
  write(path: string, data: string | Uint8Array): void;
  delete(path: string): boolean;
  exists(path: string): boolean;
  list(dir?: string): FileEntry[];
}

export interface AppLog {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface BackendContext {
  readonly appId: string;
  /** The app's only writable directory, shared by every version. */
  readonly dataDir: string;
  /** Model calls through the user's configured providers (needs the `ai` capability). */
  readonly ai: {
    generate(input: AiGenerateInput): Promise<AiGenerateOutput>;
    stream(input: AiGenerateInput): StreamHandle<AiStreamChunk, AiGenerateOutput>;
  };
  readonly agent: {
    /** Runs an agent task (with the app's origin) through the user's permission gate. */
    run(input: AgentRunInput): StreamHandle<AgentRunChunk, AgentRunOutput>;
  };
  readonly memory: {
    search: Op<'memory.search'>;
    read: Op<'memory.read'>;
    write: Op<'memory.write'>;
  };
  readonly mcp: {
    listTools: Op<'mcp.listTools'>;
    callTool: Op<'mcp.callTool'>;
  };
  readonly web: {
    search: Op<'web.search'>;
    fetch: Op<'web.fetch'>;
  };
  /** `<dataDir>/app.db`, opened on first use. Migrate idempotently in `onStart`. */
  readonly db: DatabaseSync;
  readonly kv: KeyValueStore;
  readonly files: AppFiles;
  readonly events: {
    /** Delivers `data` to pages subscribed to `channel` (`events.subscribe` in the client SDK). */
    publish(channel: string, data?: unknown): void;
  };
  readonly widgets: {
    /** Asks the service to re-render one widget (or all) after the data behind it changed. */
    reload(widgetId?: string): void;
  };
  readonly log: AppLog;
}

/** The context of one api call: the backend context plus the call's cancellation signal. */
export interface CallContext extends BackendContext {
  readonly signal: AbortSignal;
}

/**
 * An api function. It returns a value (a plain call), or an async iterable whose items stream to
 * the page as chunks; a generator's return value becomes the stream's result. Inputs and results
 * are JSON plus `Uint8Array`s.
 */
export type ApiHandler = (input: never, ctx: CallContext) => unknown;
export type ApiMap = Record<string, ApiHandler>;

export interface BackendDefinition<Api extends ApiMap = ApiMap> {
  api: Api;
  widgets?: WidgetDefinition[];
  /** Runs before the backend reports ready; a throw fails the start. */
  onStart?: (ctx: BackendContext) => void | Promise<void>;
  /** Runs when the service stops the backend (bounded by a short timeout). */
  onStop?: (ctx: BackendContext) => void | Promise<void>;
}
