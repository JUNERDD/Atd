import { randomUUID } from 'node:crypto';
import type { WebSocket } from '@fastify/websocket';
import {
  CapabilityResultSchema,
  DesktopCapabilitySchema,
  errorMessage,
  parse,
  SubscribeSchema,
  type CapabilityRequest,
  type DesktopCapability,
  type InvalidateFrame,
  type ServiceEvent,
  type StatusFrame,
  type SummariesFrame,
  type TaskSnapshot,
} from '@ai/agent-contracts';
import { Value } from 'typebox/value';
import type { CapabilityRegistry } from './capabilities.js';
import type { EventLog } from './event-log.js';
import type { Logger } from './logging.js';
import type { TaskStatusCounts } from './task-status.js';

export interface StreamDeps {
  events: EventLog;
  capabilities: CapabilityRegistry;
  snapshot: (taskId: string) => Promise<TaskSnapshot>;
  /** Every task's summary as of one stream position; must not await (see `subscribe`). */
  summaries: () => Omit<SummariesFrame, 'type'>;
  /** The current root-task counts for `status` frames. */
  status: () => TaskStatusCounts;
  /** Registers a listener for every change that may move those counts. */
  onStatusInputs: (listener: () => void) => void;
  log: Logger;
}

/**
 * Unsent bytes above which a connection counts as backlogged. A client that stays backlogged for
 * `BACKLOG_GRACE_MS` is cut off so its buffer cannot grow without bound; it reconnects and
 * resubscribes from its (epoch, seq), getting a replay or a fresh summary. The grace keeps a
 * burst, such as the frames a subscribe sends, from cutting off a client that is draining it.
 */
const BACKLOG_LIMIT_BYTES = 8 * 1024 * 1024;
const BACKLOG_GRACE_MS = 10_000;

interface Connection {
  socket: WebSocket;
  tasks: Set<string> | null;
  clientId: string | null;
  /** When the connection's unsent bytes last rose above `BACKLOG_LIMIT_BYTES`; null below it. */
  backloggedSince: number | null;
  /** The counts last sent in a `status` frame; null while its subscription did not ask for them. */
  status: TaskStatusCounts | null;
}

/**
 * WS hub for task events, pending confirms and the desktop capability
 * channel. Subscribe replays bounded events or answers with summaries (or, for
 * named tasks, snapshots), plus root-task `status` counts when asked; capability
 * frames register clients and route request/result pairs.
 */
export class StreamHub {
  private readonly connections = new Set<Connection>();

  constructor(private readonly deps: StreamDeps) {
    deps.events.onPublish((event) => this.broadcast(event));
    deps.capabilities.deliver = (request) => this.deliver(request);
    deps.onStatusInputs(() => this.statusChanged());
  }

  handle(socket: WebSocket): void {
    const connection: Connection = {
      socket,
      tasks: null,
      clientId: null,
      backloggedSince: null,
      status: null,
    };
    this.connections.add(connection);
    socket.on('message', (raw: unknown) => {
      void this.onMessage(connection, String(raw)).catch((error: unknown) => {
        this.send(socket, { type: 'error', error: errorMessage(error) });
      });
    });
    socket.on('close', () => {
      this.connections.delete(connection);
      if (connection.clientId) this.deps.capabilities.unregister(connection.clientId);
    });
  }

  private send(socket: WebSocket, message: unknown): void {
    this.sendText(socket, JSON.stringify(message));
  }

  private sendText(socket: WebSocket, text: string): void {
    try {
      socket.send(text);
    } catch (error) {
      this.deps.log.debug('WS send failed.', { error: errorMessage(error) });
    }
  }

  /** Serializes each event once, however many connections receive it. */
  private broadcast(event: ServiceEvent): void {
    let text: string | null = null;
    for (const connection of this.connections) {
      if (connection.tasks && !connection.tasks.has(event.taskId)) continue;
      if (!this.writable(connection)) continue;
      text ??= JSON.stringify({ type: 'event', event });
      this.sendText(connection.socket, text);
    }
  }

  /**
   * Whether an event should still go to the connection: not once its socket is closing, and not
   * once it stayed backlogged past its grace, which terminates it (see `BACKLOG_LIMIT_BYTES`).
   */
  private writable(connection: Connection): boolean {
    const { socket } = connection;
    if (socket.readyState !== socket.OPEN) return false;
    if (socket.bufferedAmount <= BACKLOG_LIMIT_BYTES) {
      connection.backloggedSince = null;
      return true;
    }
    const now = Date.now();
    connection.backloggedSince ??= now;
    if (now - connection.backloggedSince < BACKLOG_GRACE_MS) return true;
    this.deps.log.warn('Stream client fell behind; closing it to resubscribe.', {
      buffered: socket.bufferedAmount,
    });
    // Terminate rather than close: a close frame would queue behind the backlog it ends.
    // The close handler then drops the connection and its capability registration.
    socket.terminate();
    return false;
  }

  /** Workspace changes reach every connection, whatever tasks it subscribed to. */
  invalidate(frame: InvalidateFrame): void {
    for (const connection of this.connections) this.send(connection.socket, frame);
  }

  /**
   * Sends changed counts to the connections that asked for them, each deduplicated against what
   * it last received. Counts are computed once per change, and only when someone listens.
   */
  private statusChanged(): void {
    let counts: TaskStatusCounts | null = null;
    for (const connection of this.connections) {
      const sent = connection.status;
      if (!sent) continue;
      counts ??= this.deps.status();
      if (counts.running === sent.running && counts.attention === sent.attention) continue;
      this.sendStatus(connection, counts);
    }
  }

  private sendStatus(connection: Connection, counts: TaskStatusCounts): void {
    connection.status = counts;
    this.send(connection.socket, { type: 'status', ...counts } satisfies StatusFrame);
  }

  private deliver(request: CapabilityRequest): void {
    for (const connection of this.connections) {
      if (!connection.clientId) continue;
      this.send(connection.socket, { type: 'capability.request', request });
    }
  }

  private async onMessage(connection: Connection, raw: string): Promise<void> {
    const message: unknown = JSON.parse(raw);
    if (typeof message !== 'object' || message === null || !('type' in message))
      throw new Error('Malformed stream message.');
    switch ((message as { type: string }).type) {
      case 'subscribe':
        await this.subscribe(connection, message as { [key: string]: unknown });
        break;
      case 'capability.register':
        this.register(connection, (message as { capabilities?: unknown }).capabilities);
        break;
      case 'capability.result':
        await this.capabilityResult(connection, (message as { result?: unknown }).result);
        break;
      case 'ping':
        if (connection.clientId) this.deps.capabilities.heartbeat(connection.clientId);
        this.send(connection.socket, { type: 'pong' });
        break;
      default:
        throw new Error('Unknown stream message.');
    }
  }

  private async subscribe(
    connection: Connection,
    message: { [key: string]: unknown },
  ): Promise<void> {
    const { type: _ignored, ...rest } = message;
    void _ignored;
    const subscription = parse(SubscribeSchema, rest);
    connection.tasks = subscription.taskIds ? new Set(subscription.taskIds) : null;
    // Every subscribe replaces the last: one asking for status gets the current counts at once.
    connection.status = null;
    if (subscription.status) this.sendStatus(connection, this.deps.status());
    const replay = this.deps.events.replay(subscription);
    if (replay.kind === 'events') {
      for (const event of replay.events) {
        if (connection.tasks && !connection.tasks.has(event.taskId)) continue;
        this.send(connection.socket, { type: 'event', event });
      }
      this.send(connection.socket, { type: 'resumed', seq: this.deps.events.currentSeq });
      return;
    }
    if (!subscription.taskIds) {
      // Built and sent in this turn, so no event can be broadcast between the summary's seq and
      // the frame; transcripts are loaded per task over HTTP, never pushed here.
      this.send(connection.socket, { type: 'summaries', ...this.deps.summaries() });
      return;
    }
    for (const taskId of subscription.taskIds) {
      try {
        const snapshot = await this.deps.snapshot(taskId);
        this.send(connection.socket, { type: 'snapshot', snapshot });
      } catch (error) {
        this.deps.log.debug('Snapshot for unknown task skipped.', {
          taskId,
          error: errorMessage(error),
        });
      }
    }
  }

  private register(connection: Connection, raw: unknown): void {
    if (!Array.isArray(raw) || !raw.every((item) => Value.Check(DesktopCapabilitySchema, item)))
      throw new Error('Capability registration needs a DesktopCapability array.');
    const capabilities = raw as DesktopCapability[];
    const clientId = connection.clientId ?? randomUUID();
    connection.clientId = clientId;
    this.deps.capabilities.register(clientId, capabilities);
    this.send(connection.socket, { type: 'capability.registered', clientId });
  }

  private async capabilityResult(connection: Connection, raw: unknown): Promise<void> {
    const result = parse(CapabilityResultSchema, raw);
    if (connection.clientId) this.deps.capabilities.heartbeat(connection.clientId);
    try {
      await this.deps.capabilities.result(result);
      this.send(connection.socket, {
        type: 'capability.ack',
        requestId: result.requestId,
        ok: true,
      });
    } catch (error) {
      this.send(connection.socket, {
        type: 'capability.ack',
        requestId: result.requestId,
        ok: false,
        error: errorMessage(error),
      });
    }
  }
}
