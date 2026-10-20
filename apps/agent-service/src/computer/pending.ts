import { randomUUID } from 'node:crypto';
import { Compile } from 'typebox/compile';
import {
  HostRequestSchema,
  rootExecutionId,
  type ComputerCancelReason,
  type ComputerServiceFrame,
  type ExecutionEnvelope,
  type HostOperation,
  type HostReply,
  type HostRequest,
} from '@atd/agent-contracts';
import type { Logger } from '../logging.js';

const RequestValidator = Compile(HostRequestSchema);

/**
 * How long a cancelled or timed-out request waits for the host's terminal reply before the
 * service gives up on it (D6). The host stops before its next step and still answers the request
 * in flight; a reply that arrives later is stale and settles nothing.
 */
export const CANCEL_CONVERGENCE_MS = 10_000;

/** One stream connection that announced itself as a computer host. */
export interface HostLink {
  readonly id: string;
  /** Sends one frame on this connection only; false when the socket cannot take it. */
  send(frame: ComputerServiceFrame): boolean;
}

/** The host a request goes to: its connection and the identity its replies must echo. */
export interface HostTarget {
  link: HostLink;
  hostId: string;
  hostGeneration: number;
}

/**
 * What became of one request. `reply`: the host answered it. `unsent`: it never left the service,
 * so nothing happened (`message` says why when the code alone does not). `lost`: it was sent and no reply came back in time (a timeout, a
 * disconnect, or a cancel the host did not confirm) — never "not executed": the caller records the
 * action as unknown and reconciles it through `status`.
 */
export type HostOutcome =
  | { kind: 'reply'; reply: HostReply }
  | { kind: 'unsent'; code: 'hostUnavailable' | 'cancelled'; message?: string }
  | { kind: 'lost'; reason: 'timeout' | 'disconnected' | 'cancelled' };

export interface RequestOptions {
  /** The tool call's abort signal: aborting cancels the request on the host. */
  signal?: AbortSignal | undefined;
  /** Until the host must answer; past it the request is cancelled as `timedOut`. */
  timeoutMs: number;
  /** The binding an `act` request acts on, which lists it as busy meanwhile. */
  bindingId?: string;
}

interface Pending {
  request: HostRequest;
  linkId: string;
  bindingId: string | undefined;
  cancelling: boolean;
  timer: NodeJS.Timeout | undefined;
  settle: (outcome: HostOutcome) => void;
}

/**
 * The service's requests in flight to the computer host, keyed by request id with the host
 * identity and service epoch each one was sent under. Only matching replies settle a request;
 * everything else is stale and dropped. Every request ends exactly once: replied, lost on
 * timeout, disconnect or unconfirmed cancel, or never sent.
 */
export class PendingRequests {
  /** Minted per service process; the host echoes it, so a reply to an older process is stale. */
  readonly serviceEpoch = randomUUID();
  private readonly pending = new Map<string, Pending>();

  constructor(private readonly log: Logger) {}

  /** Sends one operation to `host` and resolves once it ended (see `HostOutcome`). */
  send(
    host: HostTarget,
    envelope: ExecutionEnvelope,
    op: HostOperation,
    options: RequestOptions,
  ): Promise<HostOutcome> {
    const { signal } = options;
    if (signal?.aborted) return Promise.resolve({ kind: 'unsent', code: 'cancelled' });
    const request: HostRequest = {
      requestId: randomUUID(),
      hostId: host.hostId,
      hostGeneration: host.hostGeneration,
      serviceEpoch: this.serviceEpoch,
      envelope,
      op,
    };
    // The tool validated every field it took from the model; a failure here is a service bug.
    if (!RequestValidator.Check(request)) throw new TypeError('Invalid computer host request.');
    return new Promise<HostOutcome>((resolve) => {
      const onAbort = () => this.cancel(entry, 'stopped', host.link);
      const entry: Pending = {
        request,
        linkId: host.link.id,
        bindingId: options.bindingId,
        cancelling: false,
        timer: undefined,
        settle: (outcome) => {
          clearTimeout(entry.timer);
          signal?.removeEventListener('abort', onAbort);
          this.pending.delete(request.requestId);
          resolve(outcome);
        },
      };
      this.pending.set(request.requestId, entry);
      if (!host.link.send({ type: 'computer.request', request })) {
        entry.settle({ kind: 'unsent', code: 'hostUnavailable' });
        return;
      }
      entry.timer = setTimeout(() => this.cancel(entry, 'timedOut', host.link), options.timeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** Settles the request a reply answers, when its identity matches; answers whether it did. */
  reply(linkId: string, reply: HostReply): boolean {
    const entry = this.pending.get(reply.requestId);
    const { request } = entry ?? {};
    const matches =
      entry !== undefined &&
      request !== undefined &&
      entry.linkId === linkId &&
      reply.hostId === request.hostId &&
      reply.hostGeneration === request.hostGeneration &&
      reply.serviceEpoch === this.serviceEpoch;
    if (!matches) {
      this.log.debug('Dropped a stale computer reply.', { requestId: reply.requestId });
      return false;
    }
    entry.settle({ kind: 'reply', reply });
    return true;
  }

  /**
   * Starts the bounded convergence of every request of `runId` after the host was told to stop
   * the run (one run-wide cancel frame, sent by the caller).
   */
  cancelRun(runId: string): void {
    for (const entry of this.pending.values())
      if (entry.request.envelope.runId === runId) this.converge(entry, 'cancelled');
  }

  /** Every request sent on a connection that closed or lost the host lock is lost. */
  dropLink(linkId: string): void {
    for (const entry of this.pending.values())
      if (entry.linkId === linkId) entry.settle({ kind: 'lost', reason: 'disconnected' });
  }

  /** The runs with requests in flight, and the bindings their `act` requests hold. */
  active(): { taskId: string; runId: string; bindingId: string | undefined }[] {
    return [...this.pending.values()].map((entry) => ({
      taskId: entry.request.envelope.taskId,
      runId: entry.request.envelope.runId,
      bindingId: entry.bindingId,
    }));
  }

  /** Asks the host to stop one request, then waits a bounded time for its terminal reply. */
  private cancel(entry: Pending, reason: ComputerCancelReason, link: HostLink): void {
    if (entry.cancelling) return;
    const { runId, operationId } = entry.request.envelope;
    link.send({ type: 'computer.cancel', runId, operationId, reason });
    this.converge(entry, reason === 'timedOut' ? 'timeout' : 'cancelled');
  }

  private converge(entry: Pending, reason: 'timeout' | 'cancelled'): void {
    if (entry.cancelling) return;
    entry.cancelling = true;
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => entry.settle({ kind: 'lost', reason }), CANCEL_CONVERGENCE_MS);
  }
}

/** The envelope of a request the service makes on its own behalf for a run (release, status). */
export function serviceEnvelope(taskId: string, runId: string, purpose: string): ExecutionEnvelope {
  return {
    taskId,
    runId,
    executionId: rootExecutionId(runId),
    toolCallId: `service:${purpose}`,
    operationId: randomUUID(),
    unattended: false,
    deadlineAt: new Date(Date.now() + 30_000).toISOString(),
  };
}
