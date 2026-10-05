import { stat } from 'node:fs/promises';
import path from 'node:path';
import { backendSpawnSpec, selfCheckSandbox, type SandboxSelfCheck } from '@atd/app-kit/node';
import { errorMessage, type AppCapRequest, type AppParentMessage } from '@atd/agent-contracts';
import type { Logger } from '../logging.js';
import { BackendProcess, type ReadyInfo } from './backend-process.js';
import type { AppDiagnostics, DiagnosticInput } from './diagnostics.js';
import { backendUnavailable } from './errors.js';
import type { AppPaths } from './paths.js';
import type { AppStore } from './store.js';

/** A backend with no call for this long stops (the window has no close signal to the service). */
export const IDLE_STOP_MS = 5 * 60 * 1000;
/** A backend started only to render widgets stops sooner. */
const WIDGET_IDLE_STOP_MS = 60 * 1000;
/** Crash backoff: at most this many crashes per window, then starts are refused until it passes. */
const CRASH_LIMIT = 3;
const CRASH_WINDOW_MS = 60 * 1000;
/** Backend log lines written per batch; the rest of a larger burst is dropped. */
const LOG_BATCH = 50;
/** Default limit of a non-streaming api call; streaming calls have none. */
export const API_TIMEOUT_MS = 5 * 60 * 1000;

export interface BackendManagerDeps {
  paths: AppPaths;
  store: AppStore;
  diagnostics: AppDiagnostics;
  log: Logger;
  /** Serves one capability request of a backend; answers through `reply` until `signal` aborts. */
  capability: (
    appId: string,
    request: AppCapRequest,
    reply: (message: AppParentMessage) => boolean,
    signal: AbortSignal,
  ) => void;
  /** A backend reported its widgets (`ready`) or asked for a widget reload. */
  widgetsReady: (appId: string, version: number, info: ReadyInfo) => void;
  widgetReload: (appId: string, widgetId: string | undefined) => void;
}

interface Entry {
  process: BackendProcess | null;
  starting: Promise<BackendProcess> | null;
  crashes: number[];
  idle: NodeJS.Timeout | null;
  apiCalls: number;
  caps: Map<string, AbortController>;
}

/**
 * The app backends (plan "后端运行时"): one sandboxed child per app, started lazily on the first
 * call, stopped when idle, when a new version is published (the next call starts that one), when
 * the app's data is cleared or the app deleted, and on service shutdown. Before the first start
 * of this service process, the sandbox self-check runs once; when it fails no backend starts.
 * Unexpected exits are crashes: written to diagnostics, and after three within a minute starts
 * are refused until the minute has passed. Events the backends publish fan out to subscribers.
 */
export class AppBackends {
  private readonly entries = new Map<string, Entry>();
  private readonly subscribers = new Map<string, Set<(channel: string, data: unknown) => void>>();
  private sandbox: Promise<SandboxSelfCheck> | null = null;
  private closed = false;

  constructor(private readonly deps: BackendManagerDeps) {}

  /** The running (or starting) backend of the app's current version. */
  async ensure(appId: string): Promise<BackendProcess> {
    if (this.closed) throw backendUnavailable('The service is stopping.');
    const entry = this.entry(appId);
    const version = this.deps.store.get(appId).currentVersion;
    // A starting backend is not ready for messages yet: wait for it before using it.
    if (entry.starting) {
      const starting = await entry.starting;
      if (starting.version === version && starting.alive) return starting;
    }
    if (entry.process?.alive && entry.process.version === version) return entry.process;
    if (entry.process?.alive) await this.stop(appId);
    const start = this.start(appId, version, entry);
    entry.starting = start;
    try {
      return await start;
    } finally {
      if (entry.starting === start) entry.starting = null;
    }
  }

  /** Runs one api call; non-streaming calls time out after `API_TIMEOUT_MS`. */
  async call(
    appId: string,
    name: string,
    input: unknown,
    options: { signal?: AbortSignal; onChunk?: (data: unknown) => void },
  ): Promise<unknown> {
    const backend = await this.ensure(appId);
    const entry = this.entry(appId);
    entry.apiCalls += 1;
    this.touch(appId);
    try {
      return await backend.call(name, input, {
        ...options,
        ...(options.onChunk ? {} : { timeoutMs: API_TIMEOUT_MS }),
      });
    } finally {
      this.touch(appId);
    }
  }

  /** Renders one widget family; starts the backend for it when needed. */
  async render(
    appId: string,
    widgetId: string,
    family: Parameters<BackendProcess['renderWidget']>[1],
  ) {
    const backend = await this.ensure(appId);
    this.touch(appId);
    try {
      return await backend.renderWidget(widgetId, family, AbortSignal.timeout(30_000));
    } finally {
      this.touch(appId);
    }
  }

  /** Stops the app's backend, if any; the next call starts it again. */
  async stop(appId: string): Promise<void> {
    const entry = this.entries.get(appId);
    if (!entry) return;
    if (entry.idle) clearTimeout(entry.idle);
    entry.idle = null;
    const starting = entry.starting ? await entry.starting.catch(() => null) : null;
    const child = entry.process ?? starting;
    entry.process = null;
    await child?.stop();
  }

  /** Stops and forgets the app (deleted or its data cleared). */
  async forget(appId: string): Promise<void> {
    await this.stop(appId);
    this.entries.delete(appId);
  }

  /** Stops every backend for the shutting-down service; nothing starts afterwards. */
  async stopAll(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.entries.keys()].map((appId) => this.stop(appId)));
  }

  /** Receives what the app's backend publishes with `ctx.events.publish`. */
  subscribe(appId: string, listener: (channel: string, data: unknown) => void): () => void {
    const listeners = this.subscribers.get(appId) ?? new Set();
    listeners.add(listener);
    this.subscribers.set(appId, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.subscribers.delete(appId);
    };
  }

  private entry(appId: string): Entry {
    let entry = this.entries.get(appId);
    if (!entry) {
      entry = {
        process: null,
        starting: null,
        crashes: [],
        idle: null,
        apiCalls: 0,
        caps: new Map(),
      };
      this.entries.set(appId, entry);
    }
    return entry;
  }

  private async start(appId: string, version: number, entry: Entry): Promise<BackendProcess> {
    const now = Date.now();
    entry.crashes = entry.crashes.filter((at) => now - at < CRASH_WINDOW_MS);
    if (entry.crashes.length >= CRASH_LIMIT) {
      const retry = new Date((entry.crashes[0] ?? now) + CRASH_WINDOW_MS).toISOString();
      throw backendUnavailable(
        `The app backend crashed ${CRASH_LIMIT} times in a minute; it can start again after ${retry}.`,
      );
    }
    const versionDir = this.deps.paths.version(appId, version);
    const server = await stat(path.join(versionDir, 'server', 'index.mjs')).catch(() => null);
    if (!server?.isFile()) throw backendUnavailable('This version of the app has no backend.');
    const check = await this.selfCheck();
    if (!check.ok) {
      await this.diagnose(
        appId,
        version,
        'The backend sandbox is unavailable on this system.',
        check.reason,
      );
      throw backendUnavailable(`App backends cannot run safely on this system: ${check.reason}`);
    }
    const spec = backendSpawnSpec({
      versionDir,
      dataDir: this.deps.paths.data(appId),
      appId,
      profileDir: this.deps.paths.profilesDir,
    });
    entry.apiCalls = 0;
    const child = new BackendProcess(version, spec, this.hooks(appId, version, entry));
    entry.process = child;
    try {
      const info = await child.ready;
      this.deps.widgetsReady(appId, version, info);
      this.touch(appId);
      return child;
    } catch (error) {
      if (entry.process === child) entry.process = null;
      await child.stop();
      throw error;
    }
  }

  private hooks(appId: string, version: number, entry: Entry) {
    const logs: DiagnosticInput[] = [];
    let flush: NodeJS.Timeout | null = null;
    return {
      cap: (request: AppCapRequest) => {
        const controller = new AbortController();
        entry.caps.set(request.id, controller);
        const child = entry.process;
        this.deps.capability(
          appId,
          request,
          (message) => {
            if (message.t === 'capResult') entry.caps.delete(request.id);
            return child?.send(message) ?? false;
          },
          controller.signal,
        );
      },
      cancelCap: (id: string) => {
        entry.caps.get(id)?.abort();
        entry.caps.delete(id);
      },
      event: (channel: string, data: unknown) => {
        for (const listener of this.subscribers.get(appId) ?? []) listener(channel, data);
      },
      log: (level: 'info' | 'warn' | 'error', message: string) => {
        if (level === 'info') return this.deps.log.debug('App backend output.', { appId, message });
        logs.push({
          source: 'backend',
          level: level === 'warn' ? 'warning' : 'error',
          version,
          message,
        });
        // Batched: a burst of stderr lines becomes one write of the ring.
        flush ??= setTimeout(() => {
          flush = null;
          void this.deps.diagnostics.append(appId, logs.splice(0, LOG_BATCH));
          logs.length = 0;
        }, 200);
      },
      widgetReload: (widgetId: string | undefined) => this.deps.widgetReload(appId, widgetId),
      protocolError: (message: string) => void this.diagnose(appId, version, message),
      exit: (info: {
        expected: boolean;
        code: number | null;
        signal: string | null;
        stderr: string;
      }) => {
        for (const controller of entry.caps.values()) controller.abort();
        entry.caps.clear();
        if (entry.idle) clearTimeout(entry.idle);
        entry.idle = null;
        if (entry.process?.version === version && !entry.process.alive) entry.process = null;
        if (info.expected) return;
        entry.crashes.push(Date.now());
        const how = info.signal ? `signal ${info.signal}` : `exit code ${info.code}`;
        void this.diagnose(appId, version, `The app backend crashed (${how}).`, info.stderr);
      },
    };
  }

  /** Restarts the idle timer; a busy backend is checked again when its calls end. */
  private touch(appId: string): void {
    const entry = this.entries.get(appId);
    if (!entry?.process) return;
    if (entry.idle) clearTimeout(entry.idle);
    const delay = entry.apiCalls > 0 ? IDLE_STOP_MS : WIDGET_IDLE_STOP_MS;
    entry.idle = setTimeout(() => {
      entry.idle = null;
      if (entry.process && entry.process.inflight === 0 && entry.caps.size === 0)
        void this.stop(appId);
      else this.touch(appId);
    }, delay);
    entry.idle.unref();
  }

  private selfCheck(): Promise<SandboxSelfCheck> {
    this.sandbox ??= selfCheckSandbox({ workDir: path.join(this.deps.paths.workDir, 'selfcheck') })
      .catch((error: unknown): SandboxSelfCheck => ({ ok: false, reason: errorMessage(error) }))
      .then((result) => {
        if (!result.ok)
          this.deps.log.error('The app backend sandbox self-check failed.', {
            reason: result.reason,
          });
        return result;
      });
    return this.sandbox;
  }

  private diagnose(appId: string, version: number, message: string, detail?: string) {
    return this.deps.diagnostics.append(appId, [
      { source: 'backend', level: 'error', version, message, ...(detail ? { detail } : {}) },
    ]);
  }
}
