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
  type ServiceEvent,
  type TaskSnapshot,
} from '@ai/agent-contracts';
import { Value } from 'typebox/value';
import type { CapabilityRegistry } from './capabilities.js';
import type { EventLog } from './event-log.js';
import { Ledger } from './ledger.js';
import type { Logger } from './logging.js';

export interface StreamDeps {
  ledger: Ledger;
  events: EventLog;
  capabilities: CapabilityRegistry;
  snapshot: (taskId: string) => Promise<TaskSnapshot>;
  log: Logger;
}

interface Connection {
  socket: WebSocket;
  tasks: Set<string> | null;
  clientId: string | null;
}

/**
 * WS hub for task events, pending confirms and the desktop capability
 * channel. Subscribe replays bounded events or answers with snapshots;
 * capability frames register clients and route request/result pairs.
 */
export class StreamHub {
  private readonly connections = new Set<Connection>();

  constructor(private readonly deps: StreamDeps) {
    deps.events.onPublish((event) => this.broadcast(event));
    deps.capabilities.deliver = (request) => this.deliver(request);
  }

  handle(socket: WebSocket): void {
    const connection: Connection = { socket, tasks: null, clientId: null };
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
    try {
      socket.send(JSON.stringify(message));
    } catch (error) {
      this.deps.log.debug('WS send failed.', { error: errorMessage(error) });
    }
  }

  private broadcast(event: ServiceEvent): void {
    for (const connection of this.connections) {
      if (connection.tasks && !connection.tasks.has(event.taskId)) continue;
      this.send(connection.socket, { type: 'event', event });
    }
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
    const replay = this.deps.events.replay(subscription);
    if (replay.kind === 'events') {
      for (const event of replay.events) {
        if (connection.tasks && !connection.tasks.has(event.taskId)) continue;
        this.send(connection.socket, { type: 'event', event });
      }
      this.send(connection.socket, { type: 'resumed', seq: this.deps.events.currentSeq });
      return;
    }
    const taskIds = subscription.taskIds ?? this.deps.ledger.data.tasks.map((task) => task.id);
    for (const taskId of taskIds) {
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
