import { randomUUID } from 'node:crypto';
import { Type, type Static } from 'typebox';
import {
  CapabilityRequestSchema,
  errorMessage,
  parse,
  type CapabilityRequest,
  type CapabilityResult,
  type DesktopCapability,
} from '@ai/agent-contracts';
import type { EventLog } from './event-log.js';
import { ConflictError } from './errors.js';
import { Ledger } from './ledger.js';
import type { Logger } from './logging.js';

export interface CapabilityWaiter {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface Registration {
  clientId: string;
  capabilities: Set<DesktopCapability>;
  seenAt: number;
}

const CAPABILITY_TTL_MS = 10 * 60 * 1000;
const LEASE_MS = 5 * 60 * 1000;

/**
 * Desktop capability channel. Registrations carry a lease; requests persist
 * while waiting and match replies by id + revision. Late results are rejected.
 */
export class CapabilityRegistry {
  private readonly clients = new Map<string, Registration>();
  private readonly waiters = new Map<string, CapabilityWaiter>();
  /** Delivers `capability.request` frames to connected desktop clients. */
  deliver: (request: CapabilityRequest) => void = () => undefined;

  constructor(
    private readonly ledger: Ledger,
    private readonly events: EventLog,
    private readonly log: Logger,
  ) {}

  register(clientId: string, capabilities: DesktopCapability[]): void {
    this.clients.set(clientId, {
      clientId,
      capabilities: new Set(capabilities),
      seenAt: Date.now(),
    });
  }

  unregister(clientId: string): void {
    this.clients.delete(clientId);
  }

  heartbeat(clientId: string): void {
    const registration = this.clients.get(clientId);
    if (registration) registration.seenAt = Date.now();
  }

  pending(): CapabilityRequest[] {
    const valid: CapabilityRequest[] = [];
    for (const raw of this.ledger.data.pendingCapabilities) {
      try {
        valid.push(parse(CapabilityRequestSchema, raw));
      } catch (error) {
        this.log.warn('Dropping malformed capability request.', { error: errorMessage(error) });
      }
    }
    return valid.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  forTask(taskId: string): CapabilityRequest[] {
    return this.pending().filter((request) => request.taskId === taskId);
  }

  /**
   * Requests a desktop capability. With no registered client the call fails
   * `desktop_unavailable`; otherwise it waits, persisted, until result/expiry.
   */
  request(
    draft: Omit<CapabilityRequest, 'id' | 'revision' | 'operationId' | 'expiresAt' | 'createdAt'>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const now = Date.now();
    const live = [...this.clients.values()].some(
      (client) => now - client.seenAt < LEASE_MS && client.capabilities.has(draft.capability),
    );
    if (!live) return Promise.reject(new DesktopUnavailable(draft.capability));
    const created: CapabilityRequest = {
      ...draft,
      id: randomUUID(),
      revision: 1,
      operationId: randomUUID(),
      expiresAt: new Date(now + CAPABILITY_TTL_MS).toISOString(),
      createdAt: new Date(now).toISOString(),
    };
    return this.ledger
      .change((data) => {
        data.pendingCapabilities.push(created);
      })
      .then(
        () =>
          new Promise<unknown>((resolve, reject) => {
            this.waiters.set(created.id, { resolve, reject });
            const timer = setTimeout(() => void this.expire(created.id), CAPABILITY_TTL_MS);
            timer.unref?.();
            signal?.addEventListener(
              'abort',
              () => {
                this.waiters.delete(created.id);
                clearTimeout(timer);
                reject(new Error('Task stopped.'));
              },
              { once: true },
            );
            this.events.publish({
              taskId: created.taskId,
              runId: created.runId,
              executionId: created.executionId,
              type: 'capability.requested',
              data: { request: created },
            });
            this.deliver(created);
          }),
      );
  }

  /** Applies a desktop result; stale revisions and unknown ids are rejected. */
  async result(result: CapabilityResult): Promise<void> {
    const live = this.pending().find((item) => item.id === result.requestId);
    if (!live) throw new CapabilityGone(result.requestId);
    if (live.revision !== result.revision)
      throw new ConflictError(
        'The capability request changed. Results for the old revision are refused.',
      );
    if (Date.parse(live.expiresAt) <= Date.now()) {
      await this.expire(live.id);
      throw new CapabilityGone(result.requestId);
    }
    await this.ledger.change((data) => {
      data.pendingCapabilities = data.pendingCapabilities.filter((item) => item.id !== live.id);
    });
    const waiter = this.waiters.get(live.id);
    this.waiters.delete(live.id);
    this.events.publish({
      taskId: live.taskId,
      runId: live.runId,
      executionId: live.executionId,
      type: 'capability.resolved',
      data: { requestId: live.id, ok: result.ok, error: result.ok ? '' : (result.error ?? '') },
    });
    if (waiter) {
      if (result.ok) waiter.resolve(result.value);
      else waiter.reject(new Error(result.error || 'The desktop capability failed.'));
    }
  }

  async cancelRun(taskId: string, runId: string, reason: string): Promise<void> {
    const doomed = this.pending().filter((item) => item.taskId === taskId && item.runId === runId);
    if (!doomed.length) return;
    const ids = new Set(doomed.map((item) => item.id));
    await this.ledger.change((data) => {
      data.pendingCapabilities = data.pendingCapabilities.filter((item) => !ids.has(item.id));
    });
    for (const request of doomed) {
      const waiter = this.waiters.get(request.id);
      this.waiters.delete(request.id);
      this.events.publish({
        taskId: request.taskId,
        runId: request.runId,
        executionId: request.executionId,
        type: 'capability.resolved',
        data: { requestId: request.id, ok: false, error: reason },
      });
      waiter?.reject(new Error(reason));
    }
  }

  /** Revalidates persisted requests after a restart; expired ones resolve now. */
  async recover(): Promise<{ kept: number; dropped: number }> {
    const now = Date.now();
    const kept = this.pending().filter((request) => Date.parse(request.expiresAt) > now);
    const dropped = this.pending().filter((request) => Date.parse(request.expiresAt) <= now);
    if (dropped.length)
      await this.ledger.change((data) => {
        data.pendingCapabilities = kept;
      });
    for (const request of dropped)
      this.events.publish({
        taskId: request.taskId,
        runId: request.runId,
        executionId: request.executionId,
        type: 'capability.resolved',
        data: { requestId: request.id, ok: false, error: 'The request expired.' },
      });
    // Live waiters never survive a restart; kept requests wait for a client that
    // re-registers, then resolve through `result`. Nothing is auto-replayed.
    return { kept: kept.length, dropped: dropped.length };
  }

  private async expire(requestId: string): Promise<void> {
    const waiter = this.waiters.get(requestId);
    this.waiters.delete(requestId);
    const live = this.pending().find((item) => item.id === requestId);
    if (!live) return;
    try {
      await this.ledger.change((data) => {
        data.pendingCapabilities = data.pendingCapabilities.filter((item) => item.id !== requestId);
      });
    } catch (error) {
      this.log.warn('Capability expiry write failed.', { error: errorMessage(error) });
    }
    this.events.publish({
      taskId: live.taskId,
      runId: live.runId,
      executionId: live.executionId,
      type: 'capability.resolved',
      data: { requestId, ok: false, error: 'The request expired.' },
    });
    waiter?.reject(new Error('The desktop capability request expired.'));
  }
}

export class DesktopUnavailable extends Error {
  constructor(readonly capability: string) {
    super(`No desktop client serves ${capability}.`);
    this.name = 'DesktopUnavailable';
  }
}

export class CapabilityGone extends Error {
  constructor(readonly requestId: string) {
    super('The capability request is no longer pending.');
    this.name = 'CapabilityGone';
  }
}

/**
 * T6b additive: `file.save` write-back (mirrors the `file.pick` pattern).
 * The agent sends content; a connected desktop client shows a save dialog,
 * writes the bytes, and returns the saved name/size (never the local path,
 * matching file.pick's privacy posture). Content rides the WS capability
 * channel, so one request caps at ~525 KiB decoded; larger outputs stay in
 * the task output dir. Desktop handling is T6 resume; this module owns the
 * service side: input validation, request emit, and result matching.
 */
export const FileSaveInputSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 255 }),
    mime: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
    contentBase64: Type.String({ minLength: 1, maxLength: 700000 }),
  },
  { additionalProperties: false },
);
export type FileSaveInput = Static<typeof FileSaveInputSchema>;

export const FileSaveResultSchema = Type.Object(
  {
    saved: Type.Literal(true),
    name: Type.String({ maxLength: 255 }),
    size: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export type FileSaveResult = Static<typeof FileSaveResultSchema>;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export async function requestFileSave(
  registry: CapabilityRegistry,
  draft: {
    taskId: string;
    runId: string;
    executionId: string;
    input: FileSaveInput;
  },
  signal?: AbortSignal,
): Promise<FileSaveResult> {
  const input = parse(FileSaveInputSchema, draft.input);
  if (input.contentBase64.length % 4 !== 0 || !BASE64.test(input.contentBase64))
    throw new Error('file.save content is not valid base64.');
  const value = await registry.request(
    {
      capability: 'file.save',
      input,
      taskId: draft.taskId,
      runId: draft.runId,
      executionId: draft.executionId,
    },
    signal,
  );
  return parse(FileSaveResultSchema, value);
}
