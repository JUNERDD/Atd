import { setTimeout as delay } from 'node:timers/promises';
import { errorMessage } from '@ai/agent-contracts';
import { McpClient, McpConnectionClosedError, type McpTransport } from '@earendil-works/pi-mcp';
import type { Logger } from '../logging.js';
import {
  MCP_CLIENT_NAME_PREFIX,
  MCP_CLIENT_VERSION,
  MCP_CONNECT_RETRY_DELAYS_MS,
  MCP_IDLE_CHECK_MS,
} from './constants.js';
import { isTransientConnectError } from './errors.js';
import {
  PooledConnection,
  stderrTail,
  withStderr,
  type ConnectionContext,
  type ConnectionIdentity,
} from './pooled-connection.js';
import type {
  McpCatalogCounter,
  McpCatalogCounts,
  McpLiveConnection,
  McpTransportFactory,
  OAuthConnectionAuth,
  ResolvedLaunch,
} from './types.js';

/**
 * The process-wide pool of open MCP clients, one per physical name (a server id, or a per-task
 * alias of an isolated one). It owns opening (retries, catalog counts), dropped connections, idle
 * closes and shutdown; it knows nothing of records, approvals or logical states. What to open is
 * decided by `ConnectionManager` (mcp/connect.ts), which passes a target.
 */

/** How much of a stdio child's last stderr a close log carries. */
const CLOSE_STDERR_CHARS = 2000;

export interface PoolDeps {
  transports: McpTransportFactory;
  counter: McpCatalogCounter;
  log: Logger;
  /** Tests move the clock the idle sweep reads. */
  now?: () => number;
  /** Told whenever a connection's counts are set: after its first count and after each recount. */
  counted: (connection: McpLiveConnection) => void;
}

export interface PoolTarget extends ConnectionIdentity {
  launch: ResolvedLaunch;
  auth: OAuthConnectionAuth | undefined;
  requestTimeoutMs: number;
}

/** A dial in progress. Callers of one name and key share it; the last one to leave cancels it. */
interface Attempt {
  serverId: string;
  reuseKey: string;
  controller: AbortController;
  promise: Promise<PooledConnection>;
  waiters: number;
  settled: boolean;
}

export class McpConnectionPool {
  private readonly connections = new Map<string, PooledConnection>();
  private readonly attempts = new Map<string, Attempt>();
  private readonly closing = new Map<string, Promise<void>>();
  /** Discarded connections still finishing requests. */
  private readonly retired = new Set<PooledConnection>();
  private readonly context: ConnectionContext;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly deps: PoolDeps) {
    this.context = {
      counter: deps.counter,
      log: deps.log,
      now: deps.now ?? Date.now,
      counted: deps.counted,
      closed: (connection) => this.dropped(connection),
      drained: (connection) => void this.shut(connection),
    };
  }

  /** The open connection of `physical`, if any. */
  get(physical: string): McpLiveConnection | undefined {
    const connection = this.connections.get(physical);
    return connection?.isOpen() ? connection : undefined;
  }

  /**
   * The connection for `target`: the open one when it was opened for the same key, else a new one.
   * Concurrent callers of one name and key share a single dial; another key closes the old
   * connection (or cancels its dial) first. Aborting `signal` only leaves this caller's wait,
   * unless it was the last one waiting, which cancels the dial and closes its client.
   */
  async open(target: PoolTarget, signal?: AbortSignal): Promise<McpLiveConnection> {
    for (;;) {
      signal?.throwIfAborted();
      const closing = this.closing.get(target.physical);
      if (closing) {
        await closing;
        continue;
      }
      const open = this.connections.get(target.physical);
      const attempt = this.attempts.get(target.physical);
      if (open?.reuseKey === target.reuseKey) {
        open.touch();
        return open;
      }
      if (attempt?.reuseKey === target.reuseKey) return this.join(attempt, signal);
      if (open || attempt) {
        await this.close(target.physical);
        continue;
      }
      return this.join(this.startAttempt(target), signal);
    }
  }

  /** Cancels a dial in progress and closes the connection of `physical`; its requests fail. */
  close(physical: string): Promise<void> {
    const running = this.closing.get(physical);
    if (running) return running;
    const attempt = this.attempts.get(physical);
    if (!attempt && !this.connections.has(physical)) return Promise.resolve();
    const task = (async () => {
      if (attempt) {
        const reason = new Error(`MCP connection ${physical} was closed while connecting`);
        attempt.controller.abort(reason);
        await attempt.promise.catch(() => undefined);
      }
      // Read after the dial ended: it may have won the race with the abort.
      const connection = this.connections.get(physical);
      if (connection) await this.shut(connection);
    })().finally(() => this.closing.delete(physical));
    this.closing.set(physical, task);
    return task;
  }

  /**
   * Drops a connection the server no longer knows without failing its other requests: new callers
   * open another one, and this one closes as soon as its requests have finished.
   */
  async discard(connection: McpLiveConnection): Promise<void> {
    const current = this.connections.get(connection.physical);
    if (!current || current !== connection) return;
    this.connections.delete(current.physical);
    this.retired.add(current);
    this.stopTimerIfUnused();
    if (current.retire()) await this.shut(current);
  }

  /** Open connections and dials of the server: its base name and its task aliases. */
  namesOf(serverId: string): string[] {
    const names = new Set<string>();
    for (const connection of this.connections.values()) {
      if (connection.serverId === serverId) names.add(connection.physical);
    }
    for (const [physical, attempt] of this.attempts) {
      if (attempt.serverId === serverId) names.add(physical);
    }
    return [...names];
  }

  /** The largest counts over the server's open connections; zeros while none is open. */
  counts(serverId: string): McpCatalogCounts {
    const total: McpCatalogCounts = { tools: 0, resources: 0, prompts: 0 };
    for (const connection of this.connections.values()) {
      if (connection.serverId !== serverId) continue;
      const known = connection.counts();
      total.tools = Math.max(total.tools, known.tools);
      total.resources = Math.max(total.resources, known.resources);
      total.prompts = Math.max(total.prompts, known.prompts);
    }
    return total;
  }

  /** Closes the base connections that have had nothing in flight for `MCP_IDLE_CLOSE_MS`. */
  async sweepIdle(): Promise<void> {
    const now = this.context.now();
    const idle = [...this.connections.values()].filter((c) => c.idleClose && c.idleSince(now));
    await Promise.all(idle.map((connection) => this.close(connection.physical)));
  }

  async closeAll(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    const names = new Set([...this.connections.keys(), ...this.attempts.keys()]);
    await Promise.all([...names].map((name) => this.close(name)));
    await Promise.all([...this.retired].map((connection) => this.shut(connection)));
  }

  private startAttempt(target: PoolTarget): Attempt {
    const controller = new AbortController();
    const promise = this.dial(target, controller.signal);
    const attempt: Attempt = {
      serverId: target.serverId,
      reuseKey: target.reuseKey,
      controller,
      promise,
      waiters: 0,
      settled: false,
    };
    this.attempts.set(target.physical, attempt);
    const settle = () => {
      attempt.settled = true;
      if (this.attempts.get(target.physical) === attempt) this.attempts.delete(target.physical);
    };
    promise.then(settle, settle);
    return attempt;
  }

  private async join(attempt: Attempt, signal: AbortSignal | undefined): Promise<PooledConnection> {
    attempt.waiters += 1;
    try {
      return await (signal ? raceAbort(attempt.promise, signal) : attempt.promise);
    } finally {
      attempt.waiters -= 1;
      if (attempt.waiters === 0 && !attempt.settled) attempt.controller.abort(signal?.reason);
    }
  }

  /** Connects, retrying transient HTTP failures; a stdio child that fails to start is not rerun. */
  private async dial(target: PoolTarget, signal: AbortSignal): Promise<PooledConnection> {
    const delays = target.launch.kind === 'stdio' ? [] : MCP_CONNECT_RETRY_DELAYS_MS;
    for (let retry = 0; ; retry++) {
      try {
        return await this.connectOnce(target, signal);
      } catch (error) {
        const wait = delays[retry];
        if (signal.aborted || wait === undefined || !isTransientConnectError(error)) throw error;
        this.deps.log.debug('MCP connect failed transiently; trying again.', {
          serverId: target.serverId,
          physical: target.physical,
          delayMs: wait,
          error: target.hideUrl(errorMessage(error)),
        });
        await delay(wait, undefined, { signal }).catch(() => {
          throw abortReason(signal);
        });
      }
    }
  }

  private async connectOnce(target: PoolTarget, signal: AbortSignal): Promise<PooledConnection> {
    const { serverId, physical } = target;
    // Sampling, elicitation and roots stay undeclared: the client answers those requests -32601.
    const client = new McpClient({
      name: MCP_CLIENT_NAME_PREFIX + physical,
      version: MCP_CLIENT_VERSION,
      requestTimeoutMs: target.requestTimeoutMs,
    });
    client.onError((error) => {
      this.deps.log.debug('MCP client error.', {
        serverId,
        physical,
        error: target.hideUrl(errorMessage(error)),
      });
    });
    // connect() takes no signal, so an abort closes the client, which fails the pending initialize.
    const onAbort = () => void client.close().catch(() => undefined);
    signal.addEventListener('abort', onAbort, { once: true });
    let transport: McpTransport | undefined;
    try {
      transport = this.deps.transports(target.launch, target.auth);
      await client.connect(transport);
      const connection = new PooledConnection(target, client, transport, this.context);
      // A counter that ignores the signal must not hold up an abort or a close.
      connection.setCatalog(await raceAbort(this.deps.counter(client, signal), signal));
      signal.throwIfAborted();
      if (client.connectionState !== 'connected' || !connection.isOpen()) {
        throw new McpConnectionClosedError('MCP connection closed during setup');
      }
      this.connections.set(physical, connection);
      if (connection.idleClose) this.startTimer();
      this.deps.log.debug('MCP connection opened.', { serverId, physical, ...connection.counts() });
      return connection;
    } catch (error) {
      await client.close().catch(() => undefined);
      throw signal.aborted ? abortReason(signal) : withStderr(error, transport);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  /** The client of `connection` closed: forget it, and warn when it was in use and nobody asked. */
  private dropped(connection: PooledConnection): void {
    const current = this.connections.get(connection.physical) === connection;
    if (current) this.connections.delete(connection.physical);
    this.retired.delete(connection);
    this.stopTimerIfUnused();
    if (!current || connection.onPurpose) return;
    const stderr = stderrTail(connection.transport, CLOSE_STDERR_CHARS);
    this.deps.log.warn('MCP connection closed.', {
      serverId: connection.serverId,
      physical: connection.physical,
      ...(stderr ? { stderr } : {}),
    });
  }

  private async shut(connection: PooledConnection): Promise<void> {
    connection.onPurpose = true;
    if (this.connections.get(connection.physical) === connection) {
      this.connections.delete(connection.physical);
    }
    this.retired.delete(connection);
    this.stopTimerIfUnused();
    await connection.client.close().catch((error: unknown) => {
      this.deps.log.debug('MCP client close failed.', {
        serverId: connection.serverId,
        physical: connection.physical,
        error: connection.hideUrl(errorMessage(error)),
      });
    });
  }

  /** Looks for idle base connections while there is one to find; never keeps the process alive. */
  private startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.sweepIdle().catch((error: unknown) => {
        this.deps.log.warn('MCP idle sweep failed.', { error: errorMessage(error) });
      });
    }, MCP_IDLE_CHECK_MS);
    this.timer.unref();
  }

  private stopTimerIfUnused(): void {
    if (!this.timer) return;
    for (const connection of this.connections.values()) if (connection.idleClose) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('The operation was aborted.');
}

/** Settles with `promise`, or rejects with the abort reason as soon as `signal` aborts. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(abortReason(signal));
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
