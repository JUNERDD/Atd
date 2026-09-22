/**
 * Credential transactions per D6: one FIFO lock per credential identity that
 * covers ONLY token read/refresh/exchange/commit. Auth page waits and tool
 * execution never hold the lock. Queued entries are cancellable, commits are
 * generation-checked, and revoke/logout prohibits post-exit late writeback.
 * Invocation signals cancel one op; the lifecycle signal cancels everything.
 */

export type TokenOpKind = 'read' | 'refresh' | 'exchange' | 'commit';

export interface TokenOp {
  signal?: AbortSignal;
  kind: TokenOpKind;
}

export class TxnAborted extends Error {
  constructor(reason = 'The credential operation was cancelled.') {
    super(reason);
    this.name = 'TxnAborted';
  }
}

export class TxnRevoked extends Error {
  constructor(readonly identity: string) {
    super(`Credential ${identity} was revoked; the queued operation is refused.`);
    this.name = 'TxnRevoked';
  }
}

export class LateWritebackProhibited extends Error {
  constructor(readonly identity: string) {
    super(`Credential ${identity} changed while the operation ran; late writeback is prohibited.`);
    this.name = 'LateWritebackProhibited';
  }
}

interface QueueEntry<T> {
  op: (ctx: { signal: AbortSignal; generation: number }) => Promise<T>;
  invocation?: AbortSignal;
  generation: number;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

interface IdentityState {
  active: boolean;
  generation: number;
  lifecycle: AbortController;
  queue: Array<QueueEntry<unknown>>;
}

export class CredentialTransactions {
  private readonly states = new Map<string, IdentityState>();

  private stateFor(identity: string): IdentityState {
    let state = this.states.get(identity);
    if (!state) {
      state = { active: false, generation: 0, lifecycle: new AbortController(), queue: [] };
      this.states.set(identity, state);
    }
    return state;
  }

  /** Runs one token op under the identity lock; FIFO, cancellable queue. */
  runTokenOp<T>(
    identity: string,
    op: (ctx: { signal: AbortSignal; generation: number }) => Promise<T>,
    options: TokenOp = { kind: 'read' },
  ): Promise<T> {
    const state = this.stateFor(identity);
    if (options.signal?.aborted) return Promise.reject(new TxnAborted());
    if (state.lifecycle.signal.aborted) return Promise.reject(new TxnRevoked(identity));
    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry<T> = {
        op,
        invocation: options.signal,
        generation: state.generation,
        resolve,
        reject,
      };
      const onAbort = () => {
        const index = state.queue.indexOf(entry as QueueEntry<unknown>);
        if (index >= 0) {
          state.queue.splice(index, 1);
          reject(new TxnAborted());
        }
      };
      options.signal?.addEventListener('abort', onAbort, { once: true });
      const wrappedResolve = (value: T) => {
        options.signal?.removeEventListener('abort', onAbort);
        resolve(value);
      };
      const wrappedReject = (error: Error) => {
        options.signal?.removeEventListener('abort', onAbort);
        reject(error);
      };
      state.queue.push({
        ...entry,
        resolve: wrappedResolve,
        reject: wrappedReject,
      } as QueueEntry<unknown>);
      void this.drain(identity);
    });
  }

  /**
   * Generation-checked commit: runs `write` only when the identity still
   * carries the generation the op started with. Stale generations reject
   * without touching the store, which prohibits post-exit late writeback.
   */
  async commitChecked<T>(
    identity: string,
    generation: number,
    write: () => Promise<T>,
  ): Promise<T> {
    const state = this.stateFor(identity);
    if (state.lifecycle.signal.aborted || state.generation !== generation) {
      throw new LateWritebackProhibited(identity);
    }
    return write();
  }

  /**
   * Revokes an identity immediately: queued entries reject, the active op
   * observes the lifecycle abort, and the generation bump invalidates every
   * pending commit. A fresh lifecycle starts for the next op.
   */
  revoke(identity: string): void {
    const state = this.stateFor(identity);
    state.generation += 1;
    state.lifecycle.abort(new TxnRevoked(identity));
    state.lifecycle = new AbortController();
    const queued = state.queue.splice(0, state.queue.length);
    for (const entry of queued) entry.reject(new TxnRevoked(identity));
  }

  generation(identity: string): number {
    return this.stateFor(identity).generation;
  }

  isLocked(identity: string): boolean {
    const state = this.states.get(identity);
    return state?.active ?? false;
  }

  queuedCount(identity: string): number {
    return this.states.get(identity)?.queue.length ?? 0;
  }

  private async drain(identity: string): Promise<void> {
    const state = this.stateFor(identity);
    if (state.active) return;
    const next = state.queue.shift() as QueueEntry<unknown> | undefined;
    if (!next) return;
    state.active = true;
    try {
      if (next.invocation?.aborted) {
        next.reject(new TxnAborted());
        return;
      }
      if (state.lifecycle.signal.aborted || next.generation !== state.generation) {
        next.reject(new TxnRevoked(identity));
        return;
      }
      const combined = combine(state.lifecycle.signal, next.invocation);
      try {
        const value = await next.op({ signal: combined.signal, generation: next.generation });
        next.resolve(value);
      } catch (error) {
        next.reject(error instanceof Error ? error : new Error(String(error)));
      } finally {
        combined.cleanup();
      }
    } finally {
      // Settle-then-release: the lock frees only after the op settles.
      state.active = false;
      if (state.queue.length) void this.drain(identity);
    }
  }
}

/** Combines lifecycle + invocation signals without AbortSignal.any. */
function combine(
  first: AbortSignal,
  second?: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const propagate = () => {
    if (!controller.signal.aborted) controller.abort(first.aborted ? first.reason : second?.reason);
  };
  if (first.aborted || second?.aborted) {
    controller.abort(first.aborted ? first.reason : second?.reason);
    return { signal: controller.signal, cleanup: () => undefined };
  }
  first.addEventListener('abort', propagate, { once: true });
  second?.addEventListener('abort', propagate, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      first.removeEventListener('abort', propagate);
      second?.removeEventListener('abort', propagate);
    },
  };
}
