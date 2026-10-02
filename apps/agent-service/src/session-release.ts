import { errorMessage, isActiveStatus } from '@atd/agent-contracts';
import type { CapabilityRegistry } from './capabilities.js';
import type { ConfirmStore } from './confirms.js';
import type { Ledger } from './ledger.js';
import type { LiveState } from './live-state.js';
import type { Logger } from './logging.js';
import type { RunnerMemoryScope } from './memory/index.js';

/**
 * Releasing a task's live Pi session, so the service holds sessions only for tasks in use rather
 * than for every task run since it started. A runner keeps its session in a `LiveSlot`, which
 * serializes a release against reopening the same session file; `SessionReleases` decides when
 * the manager releases one: after an idle period, or on request (a tier change). A released task
 * reopens from its session file on its next run or compaction.
 */

/** How long a task's live session outlives the last execution or compaction that used it. */
export const IDLE_RELEASE_MS = 10 * 60 * 1000;

/** Runs session work inside a memory scope (task-runner.ts `memoryTurn`). */
type MemoryTurn = <T>(scope: RunnerMemoryScope | null, action: () => Promise<T>) => Promise<T>;

/**
 * A runner's live session and the memory scope of the run it last served. Closing detaches the
 * session at once and then shuts it down: Hermes' shutdown flush, which may make one model call,
 * learns under that scope. Until the shutdown ends, `settled` holds back whatever would reopen the
 * session file, so two sessions never write it at once. A `quit` close is final: a session opened
 * after it (a compaction of a task deleted meanwhile) is shut down instead of held.
 */
export class LiveSlot {
  private held: { live: LiveState; memory: RunnerMemoryScope | null } | null = null;
  private closing: Promise<void> | null = null;
  private quit = false;

  constructor(private readonly turn: MemoryTurn) {}

  get live(): LiveState | null {
    return this.held?.live ?? null;
  }

  get memory(): RunnerMemoryScope | null {
    return this.held?.memory ?? null;
  }

  get releasing(): boolean {
    return this.closing !== null;
  }

  /** Resolves once no shutdown is in flight; a failed shutdown does not keep the file closed. */
  async settled(): Promise<void> {
    await this.closing?.catch(() => undefined);
  }

  /** Holds a session opened after `settled`; its shutdown flush learns under `memory`. */
  hold(live: LiveState, memory: RunnerMemoryScope | null): LiveState {
    if (this.quit) {
      void this.shutdown(live, memory, 'quit').catch(() => undefined);
      throw new Error('The task was closed.');
    }
    if (this.closing) throw new Error('The task session is still shutting down.');
    this.held = { live, memory };
    return live;
  }

  /** Points the shutdown flush at the run a reused session serves now. */
  rescope(memory: RunnerMemoryScope): void {
    if (this.held) this.held.memory = memory;
  }

  /** Detaches and shuts down the held session; callers during a shutdown share it. */
  close(reason: 'new' | 'quit'): Promise<void> {
    if (reason === 'quit') this.quit = true;
    const held = this.held;
    this.held = null;
    if (held) {
      const closing = this.shutdown(held.live, held.memory, reason).finally(() => {
        if (this.closing === closing) this.closing = null;
      });
      this.closing = closing;
    }
    return this.closing ?? Promise.resolve();
  }

  private async shutdown(
    live: LiveState,
    memory: RunnerMemoryScope | null,
    reason: 'new' | 'quit',
  ): Promise<void> {
    live.transcript.dispose();
    try {
      await this.turn(memory, () =>
        live.session.extensionRunner.emit({ type: 'session_shutdown', reason }),
      );
    } finally {
      // A failed flush must not leave the detached session undisposed.
      live.session.dispose();
    }
  }
}

/** The runner surface the release policy reads and releases through (task-runner.ts). */
export interface ReleasableRunner {
  isLive(): boolean;
  isCompacting(): boolean;
  isReleasing(): boolean;
  release(): Promise<void>;
}

export interface SessionReleaseDeps {
  ctx: { ledger: Ledger; confirms: ConfirmStore; capabilities: CapabilityRegistry; log: Logger };
  /** Idle time before a release; `IDLE_RELEASE_MS` unless set. */
  idleMs: number | undefined;
  draining: () => boolean;
  runner: (taskId: string) => ReleasableRunner | undefined;
  /** Whether an execution of the run has not settled yet (runner-manager.ts `executions`). */
  executing: (runId: string) => boolean;
}

/**
 * When the manager releases task sessions. A task's idle countdown starts when its last execution
 * or compaction settles and stops when another starts; timers never keep the process alive. When
 * one fires, the session is released only if the task is still idle (`idle`); otherwise the next
 * execution or compaction to settle starts a new countdown.
 */
export class SessionReleases {
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly deps: SessionReleaseDeps) {}

  /** Stops the task's countdown while `work` uses its session, and restarts it once it settles. */
  busy(taskId: string, work: Promise<unknown>): void {
    this.cancel(taskId);
    void work.then(
      () => this.schedule(taskId),
      () => this.schedule(taskId),
    );
  }

  cancel(taskId: string): void {
    clearTimeout(this.timers.get(taskId));
    this.timers.delete(taskId);
  }

  cancelAll(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /** Releases the task's live session now; a run started meanwhile reopens it once it settles. */
  async release(taskId: string): Promise<void> {
    this.cancel(taskId);
    await this.deps.runner(taskId)?.release();
  }

  private schedule(taskId: string): void {
    this.cancel(taskId);
    // A removed task has no runner, and draining disposes every runner anyway.
    if (this.deps.draining() || !this.deps.runner(taskId)) return;
    const timer = setTimeout(() => {
      this.timers.delete(taskId);
      if (!this.idle(taskId)) return;
      void this.release(taskId).catch((error: unknown) => {
        this.deps.ctx.log.warn('Idle session release failed.', {
          taskId,
          error: errorMessage(error),
        });
      });
    }, this.deps.idleMs ?? IDLE_RELEASE_MS);
    timer.unref();
    this.timers.set(taskId, timer);
  }

  /**
   * Whether the task's live session is idle: nothing started, queued, executing, compacting or
   * releasing, and no approval or capability request waiting on it.
   */
  private idle(taskId: string): boolean {
    const { ctx, draining, executing } = this.deps;
    const runner = this.deps.runner(taskId);
    const task = ctx.ledger.data.tasks.find((item) => item.id === taskId);
    if (draining() || !runner || !task) return false;
    if (!runner.isLive() || runner.isCompacting() || runner.isReleasing()) return false;
    if (task.runs.some((run) => isActiveStatus(run.status) || executing(run.id))) return false;
    return !ctx.confirms.forTask(taskId).length && !ctx.capabilities.forTask(taskId).length;
  }
}
