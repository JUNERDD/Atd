import { PROTOCOL_VERSION, type EventType, type ServiceEvent } from '@atd/agent-contracts';

/** Bounded in-memory event buffer; slow clients fall back to snapshots. */
const BUFFER_LIMIT = 500;

export type ReplayResult = { kind: 'events'; events: ServiceEvent[] } | { kind: 'snapshot' };

export type EventListener = (event: ServiceEvent) => void;

/**
 * Epoch/seq event log. Seq is monotonic within an epoch; a new epoch or an
 * evicted seq answers `snapshot` so clients reseed instead of guessing.
 */
export class EventLog {
  private seq = 0;
  private readonly order: number[] = [];
  private readonly buffered = new Map<number, ServiceEvent>();
  private readonly listeners = new Set<EventListener>();

  constructor(
    private readonly serviceId: string,
    readonly epoch: number,
  ) {}

  get currentSeq(): number {
    return this.seq;
  }

  /** Registers a broadcast listener; used by the WS hub. Failures are isolated. */
  onPublish(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  publish(options: {
    taskId: string;
    runId: string | null;
    executionId: string;
    type: EventType;
    data: unknown;
  }): ServiceEvent {
    this.seq += 1;
    const event: ServiceEvent = {
      serviceId: this.serviceId,
      protocolVersion: PROTOCOL_VERSION,
      epoch: this.epoch,
      seq: this.seq,
      taskId: options.taskId,
      runId: options.runId,
      executionId: options.executionId,
      type: options.type,
      at: new Date().toISOString(),
      data: options.data,
    };
    this.buffered.set(event.seq, event);
    this.order.push(event.seq);
    while (this.order.length > BUFFER_LIMIT) {
      const evicted = this.order.shift();
      if (evicted !== undefined) this.buffered.delete(evicted);
    }
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // One slow or broken socket must not break the event log.
      }
    }
    return event;
  }

  replay(subscription: { epoch: number; seq: number; taskIds?: string[] }): ReplayResult {
    if (subscription.epoch !== this.epoch) return { kind: 'snapshot' };
    if (subscription.seq > this.seq) return { kind: 'snapshot' };
    const oldest = this.order[0];
    if (subscription.seq > 0 && oldest !== undefined && subscription.seq < oldest)
      return { kind: 'snapshot' };
    const wanted = subscription.taskIds ? new Set(subscription.taskIds) : null;
    const events: ServiceEvent[] = [];
    for (const seq of this.order) {
      if (seq <= subscription.seq) continue;
      const event = this.buffered.get(seq);
      if (event && (!wanted || wanted.has(event.taskId))) events.push(event);
    }
    return { kind: 'events', events };
  }
}
