import { spawn, type ChildProcess } from 'node:child_process';
import type { BackendSpawnSpec } from '@atd/app-kit/node';
import { Compile } from 'typebox/compile';
import {
  AppChildMessageSchema,
  MAX_IPC_MESSAGE_BYTES,
  type AppCapRequest,
  type AppChildMessage,
  type AppParentMessage,
  type WidgetDecl,
} from '@atd/agent-contracts';
import { AppFailure, backendUnavailable, fromBackendError } from './errors.js';

/** How long a backend may take from spawn to `ready` (its `onStart` included). */
const READY_TIMEOUT_MS = 30_000;
/** Grace between SIGTERM (the runtime runs `onStop`, at most 5 s) and SIGKILL. */
const STOP_GRACE_MS = 7_000;
/** Bytes of stderr kept for a crash report. */
const STDERR_TAIL = 8 * 1024;

const ChildMessageValidator = Compile(AppChildMessageSchema);

export interface ReadyInfo {
  api: string[];
  widgets: WidgetDecl[];
}

/** The build a backend runs: its version, for diagnostics, and its revision, its identity. */
export interface BackendBuild {
  version: number;
  revision: number;
}

/** What one backend child reports to its manager. */
export interface BackendHooks {
  cap: (request: AppCapRequest) => void;
  /** The child no longer needs the answer to its capability request `id`. */
  cancelCap: (id: string) => void;
  event: (channel: string, data: unknown) => void;
  /** `ctx.log` messages and the child's stdout (`info`) and stderr (`error`) lines. */
  log: (level: 'info' | 'warn' | 'error', message: string) => void;
  widgetReload: (widgetId: string | undefined) => void;
  /** A message that failed validation or the size limit; it was dropped. */
  protocolError: (message: string) => void;
  /** The child exited; `expected` when `stop` asked it to. */
  exit: (info: {
    expected: boolean;
    code: number | null;
    signal: string | null;
    stderr: string;
  }) => void;
}

interface Pending {
  chunk?: (data: unknown) => void;
  resolve: (value: unknown) => void;
  reject: (error: AppFailure) => void;
}

/**
 * One running app backend: the sandboxed child (`backendSpawnSpec`) and the parent half of the
 * IPC protocol (`apps-ipc.ts`). Every inbound message is validated against the child union and
 * the 4 MiB limit before it is acted on; outbound ones are checked against the limit too. Calls
 * and widget renders are numbered `p<n>`; a caller's abort sends `cancel`.
 */
export class BackendProcess {
  readonly ready: Promise<ReadyInfo>;
  /** Settles once the child is gone, however it went. */
  private readonly gone: Promise<void>;
  private readonly child: ChildProcess;
  private readonly pending = new Map<string, Pending>();
  private nextId = 0;
  private stopping = false;
  private exited = false;
  private stderrTail = '';

  readonly version: number;
  readonly revision: number;

  constructor(
    build: BackendBuild,
    spec: BackendSpawnSpec,
    private readonly hooks: BackendHooks,
  ) {
    this.version = build.version;
    this.revision = build.revision;
    let markExited: () => void = () => undefined;
    this.gone = new Promise((resolve) => {
      markExited = resolve;
    });
    // The spec's environment is complete (LANG, TZ, ATD_APP_ID): never `process.env`.
    this.child = spawn(spec.command, spec.args, {
      env: spec.env,
      cwd: spec.cwd,
      stdio: spec.stdio,
    });
    this.lines(this.child.stdout, (line) => hooks.log('info', line));
    this.lines(this.child.stderr, (line) => {
      this.stderrTail = `${this.stderrTail}${line}\n`.slice(-STDERR_TAIL);
      hooks.log('error', line);
    });
    let readyResolve: (info: ReadyInfo) => void = () => undefined;
    let readyReject: (error: AppFailure) => void = () => undefined;
    this.ready = new Promise<ReadyInfo>((resolve, reject) => {
      readyResolve = resolve;
      readyReject = reject;
    });
    // Callers attach later; a rejection before then must not be unhandled.
    this.ready.catch(() => undefined);
    const timer = setTimeout(() => {
      readyReject(backendUnavailable('The app backend did not start within 30 seconds.'));
      void this.stop();
    }, READY_TIMEOUT_MS);
    this.child.on('message', (raw: unknown) => {
      const message = this.validate(raw);
      if (!message) return;
      if (message.t === 'ready') {
        clearTimeout(timer);
        readyResolve({ api: message.api, widgets: message.widgets });
      } else this.receive(message);
    });
    const onExit = (code: number | null, signal: string | null) => {
      if (this.exited) return;
      clearTimeout(timer);
      this.exited = true;
      markExited();
      const failure = backendUnavailable(
        this.stopping
          ? 'The app backend stopped.'
          : `The app backend exited (${signal ?? `code ${code}`}). ${this.stderrTail.slice(-1000)}`.trim(),
      );
      readyReject(failure);
      for (const pending of this.pending.values()) pending.reject(failure);
      this.pending.clear();
      hooks.exit({ expected: this.stopping, code, signal, stderr: this.stderrTail });
    };
    this.child.on('exit', onExit);
    this.child.on('error', (error) => {
      this.stderrTail += `${error.message}\n`;
      // A child that never spawned (no pid) emits no `exit`.
      if (this.child.pid === undefined) onExit(null, null);
    });
  }

  get alive(): boolean {
    return !this.exited && !this.stopping;
  }

  /** Requests in flight (calls and widget renders). */
  get inflight(): number {
    return this.pending.size;
  }

  /**
   * Runs api function `name`. `onChunk` makes it a streaming call. Rejects with the backend's
   * error, `cancelled` when `signal` aborts (after telling the child), or a timeout.
   */
  call(
    name: string,
    input: unknown,
    options: { signal?: AbortSignal; onChunk?: (data: unknown) => void; timeoutMs?: number },
  ): Promise<unknown> {
    const id = this.id();
    const stream = options.onChunk !== undefined;
    return this.request(id, { t: 'call', id, name, input, stream }, options);
  }

  /** Renders one widget; resolves with the unvalidated timeline the child returned. */
  renderWidget(
    widgetId: string,
    family: Extract<AppParentMessage, { t: 'widget' }>['family'],
    signal: AbortSignal,
  ): Promise<unknown> {
    const id = this.id();
    return this.request(
      id,
      { t: 'widget', id, widgetId, family, config: {} },
      {
        signal,
        timeoutMs: 30_000,
      },
    );
  }

  /** Sends a `capChunk` or `capResult`; false when the child is gone or the message too large. */
  send(message: AppParentMessage): boolean {
    if (this.exited || !this.child.connected) return false;
    if (Buffer.byteLength(JSON.stringify(message)) > MAX_IPC_MESSAGE_BYTES) return false;
    this.child.send(message);
    return true;
  }

  /** SIGTERM, then SIGKILL after the grace; resolves once the child is gone. */
  stop(): Promise<void> {
    this.stopping = true;
    if (this.exited) return Promise.resolve();
    const kill = setTimeout(() => this.child.kill('SIGKILL'), STOP_GRACE_MS);
    this.child.kill('SIGTERM');
    return this.gone.finally(() => clearTimeout(kill));
  }

  private id(): string {
    this.nextId += 1;
    return `p${this.nextId}`;
  }

  private request(
    id: string,
    message: AppParentMessage,
    options: { signal?: AbortSignal; onChunk?: (data: unknown) => void; timeoutMs?: number },
  ): Promise<unknown> {
    const { signal } = options;
    if (signal?.aborted) return Promise.reject(new AppFailure(499, 'cancelled', 'Cancelled.'));
    return new Promise((resolve, reject) => {
      let timer: NodeJS.Timeout | undefined;
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.pending.delete(id);
      };
      const fail = (error: AppFailure) => {
        done();
        reject(error);
      };
      const onAbort = () => {
        this.send({ t: 'cancel', id });
        fail(new AppFailure(499, 'cancelled', 'The call was cancelled.'));
      };
      this.pending.set(id, {
        ...(options.onChunk ? { chunk: options.onChunk } : {}),
        resolve: (value) => {
          done();
          resolve(value);
        },
        reject: fail,
      });
      if (options.timeoutMs !== undefined)
        timer = setTimeout(() => {
          this.send({ t: 'cancel', id });
          fail(new AppFailure(504, 'timeout', 'The app backend did not answer in time.'));
        }, options.timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (!this.send(message))
        fail(
          this.exited
            ? backendUnavailable('The app backend is not running.')
            : new AppFailure(413, 'payload_too_large', 'The input exceeds the 4 MiB IPC limit.'),
        );
    });
  }

  private receive(message: Exclude<AppChildMessage, { t: 'ready' }>): void {
    switch (message.t) {
      case 'chunk':
        this.pending.get(message.id)?.chunk?.(message.data);
        return;
      case 'result': {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        if (message.ok) pending.resolve(message.value);
        else pending.reject(fromBackendError(message.error));
        return;
      }
      case 'cap':
        this.hooks.cap(message);
        return;
      case 'cancel':
        this.hooks.cancelCap(message.id);
        return;
      case 'event':
        this.hooks.event(message.channel, message.data);
        return;
      case 'log':
        this.hooks.log(message.level, message.message);
        return;
      case 'widgetReload':
        this.hooks.widgetReload(message.widgetId);
        return;
    }
  }

  /** The message when it is valid and within the limit; otherwise reports and drops it. */
  private validate(raw: unknown): AppChildMessage | null {
    const size = Buffer.byteLength(JSON.stringify(raw) ?? '');
    const id = typeof raw === 'object' && raw !== null ? Reflect.get(raw, 'id') : undefined;
    const t = typeof raw === 'object' && raw !== null ? Reflect.get(raw, 't') : undefined;
    if (size <= MAX_IPC_MESSAGE_BYTES && ChildMessageValidator.Check(raw)) return raw;
    const problem =
      size > MAX_IPC_MESSAGE_BYTES
        ? 'exceeds the 4 MiB IPC limit'
        : 'does not match the IPC protocol';
    const detail = `A backend message${typeof t === 'string' ? ` of type "${t}"` : ''} ${problem}.`;
    this.hooks.protocolError(detail);
    if (typeof id === 'string') {
      // Answer what the bad message was about, so nothing waits forever.
      if (t === 'cap')
        this.send({
          t: 'capResult',
          id,
          ok: false,
          error: { code: 'bad_request', message: detail },
        });
      else this.pending.get(id)?.reject(new AppFailure(502, 'bad_response', detail));
    }
    return null;
  }

  private lines(stream: NodeJS.ReadableStream | null, onLine: (line: string) => void): void {
    if (!stream) return;
    let buffer = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trimEnd();
        buffer = buffer.slice(newline + 1);
        if (line) onLine(line.slice(0, 16000));
        newline = buffer.indexOf('\n');
      }
      if (buffer.length > 64 * 1024) buffer = buffer.slice(-16000);
    });
  }
}
