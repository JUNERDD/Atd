import {
  CapabilityRequestSchema,
  InvalidateFrameSchema,
  parse,
  ServiceEventSchema,
  STREAM_AUTH_PROTOCOL_PREFIX,
  STREAM_PROTOCOL,
  SummariesFrameSchema,
  TaskSnapshotSchema,
  type CapabilityRequest,
  type ServiceEvent,
} from '@ai/agent-contracts';
import type { AgentClientOptions, CapabilityHandler, StreamHandlers } from './types.js';

interface StreamState {
  epoch: number;
  seq: number;
}

const MAX_BACKOFF_MS = 5000;

/**
 * WS stream client with reconnect. Tracks (epoch, seq) and resubscribes after a
 * drop; the service replays bounded events or answers with fresh task summaries
 * (per-task snapshots when the client subscribed to named tasks).
 */
export class AgentStreamClient {
  private socket: WebSocket | null = null;
  private readonly state: StreamState = { epoch: 0, seq: 0 };
  private failures = 0;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly options: AgentClientOptions,
    private readonly handlers: StreamHandlers,
    private readonly taskIds: string[] = [],
    private readonly capabilities: CapabilityHandler[] = [],
  ) {}

  get epoch(): number {
    return this.state.epoch;
  }

  get seq(): number {
    return this.state.seq;
  }

  connect(): void {
    this.closed = false;
    this.failures = 0;
    this.open();
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.socket?.close();
    this.socket = null;
  }

  /**
   * Uses the standard `WebSocket` global (Node 22+, Electron, browsers). Browsers cannot set
   * headers on a socket, so every client sends its credential as the `ai.auth.<token>`
   * subprotocol next to `ai.v1`, which is the one the service selects.
   */
  private open(): void {
    const url = this.options.baseUrl.replace(/^http/, 'ws');
    const socket = new WebSocket(`${url}/v1/stream`, [
      STREAM_PROTOCOL,
      `${STREAM_AUTH_PROTOCOL_PREFIX}${this.options.token}`,
    ]);
    this.socket = socket;
    socket.addEventListener('open', () => {
      this.failures = 0;
      socket.send(
        JSON.stringify({
          type: 'subscribe',
          epoch: this.state.epoch,
          seq: this.state.seq,
          ...(this.taskIds.length ? { taskIds: this.taskIds } : {}),
        }),
      );
      if (this.capabilities.length)
        socket.send(
          JSON.stringify({
            type: 'capability.register',
            capabilities: this.capabilities.map((item) => item.capability),
          }),
        );
    });
    socket.addEventListener('message', (event) => {
      void this.onMessage(String(event.data)).catch((error: unknown) => {
        this.handlers.onDisconnect?.(error instanceof Error ? error.message : 'Stream error.');
      });
    });
    socket.addEventListener('close', (event) => {
      if (this.socket === socket) this.socket = null;
      if (this.closed) return;
      this.handlers.onDisconnect?.(`Stream closed (${event.code} ${event.reason}).`);
      this.scheduleReconnect();
    });
    // Errors surface through close; no separate handling needed.
  }

  private scheduleReconnect(): void {
    if (this.closed || this.timer) return;
    const delay = Math.min(250 * 2 ** this.failures, MAX_BACKOFF_MS);
    this.failures += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.closed) this.open();
    }, delay);
  }

  private async onMessage(raw: string): Promise<void> {
    const message: unknown = JSON.parse(raw);
    if (typeof message !== 'object' || message === null || !('type' in message)) return;
    switch ((message as { type: string }).type) {
      case 'snapshot': {
        const snapshot = parse(TaskSnapshotSchema, field(message, 'snapshot'));
        this.adopt(snapshot);
        this.handlers.onSnapshot(snapshot);
        break;
      }
      case 'summaries': {
        const frame = parse(SummariesFrameSchema, message);
        this.adopt(frame);
        this.handlers.onSummaries(frame);
        break;
      }
      case 'resumed': {
        const seq = field(message, 'seq');
        if (typeof seq === 'number') this.state.seq = seq;
        this.handlers.onResumed?.(this.state.seq);
        break;
      }
      case 'event': {
        const event = parse(ServiceEventSchema, field(message, 'event'));
        this.observe(event);
        this.handlers.onEvent(event);
        break;
      }
      case 'invalidate': {
        this.handlers.onInvalidate?.(parse(InvalidateFrameSchema, message));
        break;
      }
      case 'capability.request': {
        const request = parse(CapabilityRequestSchema, field(message, 'request'));
        await this.serveCapability(request);
        break;
      }
      default:
        break;
    }
  }

  /** Takes the stream position a snapshot or summaries frame was built at. */
  private adopt(position: StreamState): void {
    this.state.epoch = position.epoch;
    this.state.seq = position.seq;
  }

  private observe(event: ServiceEvent): void {
    if (event.epoch !== this.state.epoch) {
      // A new epoch always arrives via a snapshot or summaries frame first; ignore stray events.
      return;
    }
    if (event.seq > this.state.seq) this.state.seq = event.seq;
  }

  private async serveCapability(request: CapabilityRequest): Promise<void> {
    const handler = this.capabilities.find((item) => item.capability === request.capability);
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (!handler) {
      socket.send(
        JSON.stringify({
          type: 'capability.result',
          result: {
            requestId: request.id,
            revision: request.revision,
            ok: false,
            error: `Capability ${request.capability} is not served by this client.`,
          },
        }),
      );
      return;
    }
    try {
      const result = await handler.handle(request);
      socket.send(JSON.stringify({ type: 'capability.result', result }));
    } catch (error: unknown) {
      socket.send(
        JSON.stringify({
          type: 'capability.result',
          result: {
            requestId: request.id,
            revision: request.revision,
            ok: false,
            error: error instanceof Error ? error.message : 'Capability failed.',
          },
        }),
      );
    }
  }
}

/** Reads one field off a validated message object. */
function field(message: object, name: string): unknown {
  return (message as Record<string, unknown>)[name];
}
