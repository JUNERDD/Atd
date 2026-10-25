import type { ComputerErrorCode } from '@atd/agent-contracts';

/**
 * The worker's operation bookkeeping: the closed error codes it reports, the per-call context
 * that records whether anything reached the page, and the registry `cancel` aborts through.
 */

/** The subset of the D3 error codes the browser worker reports. */
export type WorkerErrorCode = Extract<
  ComputerErrorCode,
  | 'staleObservation'
  | 'notFound'
  | 'ambiguous'
  | 'targetChanged'
  | 'unsupported'
  | 'timeout'
  | 'cancelled'
  | 'engineFailed'
>;

/** A refusal or failure with its closed code; the tool wrapper turns it into a result. */
export class WorkerError extends Error {
  constructor(
    readonly code: WorkerErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/**
 * One tool call in flight. `dispatched` turns true just before the first command that can change
 * the page is sent and never turns back: a failure after it means the page may have changed.
 * `pageId`, `navigationGeneration` and `observationVersion` are the latest values the call read,
 * so a failed call still reports where the page stood.
 */
export interface Operation {
  readonly signal: AbortSignal;
  dispatched: boolean;
  navigationGeneration?: number;
  observationVersion?: number;
}

/** Throws `cancelled` once the operation's signal fired. */
export function throwIfCancelled(op: Operation): void {
  if (op.signal.aborted) throw new WorkerError('cancelled', 'The operation was cancelled.');
}

/**
 * Settles with `promise`, or rejects with `cancelled` as soon as the operation is cancelled. A
 * CDP command already sent keeps running in the browser; only the wait for it ends, so a
 * cancelled dispatch stays `dispatched` with an unknown outcome.
 */
export function untilCancelled<T>(op: Operation, promise: Promise<T>): Promise<T> {
  throwIfCancelled(op);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void =>
      reject(new WorkerError('cancelled', 'The operation was cancelled.'));
    op.signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        op.signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        op.signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Sleeps `ms`, ending early with `cancelled`. */
export function pause(op: Operation, ms: number): Promise<void> {
  return untilCancelled(op, new Promise<void>((resolve) => setTimeout(resolve, ms)));
}

/** How many cancelled operation ids are remembered, so a call arriving after its cancel stops. */
const CANCELLED_MEMORY = 256;

/**
 * In-flight operations by the host's `operationId`. `cancel` aborts every call carrying the id;
 * an id cancelled before its call arrives is remembered (bounded), and that call is refused
 * before it reads or dispatches anything.
 */
export class OperationRegistry {
  private readonly running = new Map<string, Set<AbortController>>();
  private readonly cancelled = new Set<string>();
  private readonly live = new Map<
    Operation,
    { controller: AbortController; operationId?: string }
  >();

  /** Starts an operation tied to the MCP request signal and, when given, the host's id. */
  begin(requestSignal: AbortSignal, operationId: string | undefined): Operation {
    const controller = new AbortController();
    const op: Operation = { signal: controller.signal, dispatched: false };
    if (operationId === undefined) this.live.set(op, { controller });
    else {
      this.live.set(op, { controller, operationId });
      if (this.cancelled.has(operationId)) controller.abort();
      const set = this.running.get(operationId) ?? new Set<AbortController>();
      set.add(controller);
      this.running.set(operationId, set);
    }
    if (requestSignal.aborted) controller.abort();
    else requestSignal.addEventListener('abort', () => controller.abort(), { once: true });
    return op;
  }

  /** Ends an operation started by `begin`. */
  end(op: Operation): void {
    const entry = this.live.get(op);
    this.live.delete(op);
    if (entry?.operationId === undefined) return;
    const set = this.running.get(entry.operationId);
    set?.delete(entry.controller);
    if (set?.size === 0) this.running.delete(entry.operationId);
  }

  /** Aborts the operations carrying `operationId`; returns how many were in flight. */
  cancel(operationId: string): number {
    this.cancelled.add(operationId);
    if (this.cancelled.size > CANCELLED_MEMORY) {
      const oldest = this.cancelled.values().next();
      if (oldest.done !== true) this.cancelled.delete(oldest.value);
    }
    const set = this.running.get(operationId);
    for (const controller of set ?? []) controller.abort();
    return set?.size ?? 0;
  }

  /** Aborts everything, for shutdown. */
  cancelAll(): void {
    for (const { controller } of this.live.values()) controller.abort();
  }
}
