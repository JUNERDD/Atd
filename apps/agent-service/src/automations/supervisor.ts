import { Compile } from 'typebox/compile';
import {
  errorMessage,
  isTerminalStatus,
  RunStatusDataSchema,
  type RunStatus,
  type ServiceEvent,
} from '@atd/agent-contracts';
import type { EventLog } from '../event-log.js';
import type { Ledger } from '../ledger.js';
import type { Logger } from '../logging.js';
import type { AutomationRuns } from './engine-deps.js';
import { readUnattendedAudit } from '../unattended.js';
import { finalAnswer, type RunEnd } from './outcome.js';

/**
 * Watches the task runs automations started until they end (decision D6): the `run.status`
 * stream announces the end, the ledger is read again when a watch begins (the run may already
 * have ended), and a run past its maximum duration is stopped through `RunnerManager.cancel` and
 * ends timed out. At the end it reads the run's final answer and what its audit recorded (the
 * unattended declines, the files it wrote), which is complete once the run's end is published
 * (task-runner.ts), and hands them to the engine.
 */

const RunStatusData = Compile(RunStatusDataSchema);

/** A task run the engine supervises. */
export interface WatchedRun {
  automationId: string;
  /** The automation's run record (`AutomationRun.id`). */
  recordId: string;
  taskId: string;
  runId: string;
  /**
   * When the task run started (epoch ms), as the supervisor first saw it running; its maximum
   * duration counts from there. Null while it waits in the queue, across a restart included.
   */
  startedAt: number | null;
  maxDurationMs: number;
  /** Chained fires between the first automation and this run (0: no other automation fired it). */
  depth: number;
  timedOut: boolean;
}

export interface SupervisorDeps {
  events: Pick<EventLog, 'onPublish'>;
  ledger: Pick<Ledger, 'run'>;
  manager: Pick<AutomationRuns, 'cancel' | 'snapshot'>;
  auditDir: string;
  log: Logger;
  now: () => number;
  /** The run ended; it still counts as active until this settles. */
  ended: (run: WatchedRun, end: RunEnd) => Promise<void>;
  /** A run left the supervisor, so a slot is free. */
  released: () => void;
}

export class RunSupervisor {
  /** Watched runs by task run id. */
  private readonly runs = new Map<string, WatchedRun>();
  /** Runs that ended and are settling, by task run id. */
  private readonly ending = new Map<string, Promise<void>>();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: SupervisorDeps) {}

  /** Starts listening; runs that end before then are settled from the ledger by `watch`. */
  listen(): void {
    this.unsubscribe ??= this.deps.events.onPublish((event) => this.onEvent(event));
  }

  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Runs being watched, including those still settling. */
  get size(): number {
    return this.runs.size;
  }

  watching(runId: string): boolean {
    return this.runs.has(runId);
  }

  watch(run: WatchedRun): void {
    this.runs.set(run.runId, run);
    let status: RunStatus;
    let error: string;
    try {
      ({ status, error } = this.deps.ledger.run(run.taskId, run.runId));
    } catch {
      // The task is gone: nothing can be read from it.
      this.end(run, 'interrupted', 'The task was deleted.');
      return;
    }
    if (isTerminalStatus(status)) this.end(run, status, error);
    else if (status !== 'queued') run.startedAt ??= this.deps.now();
  }

  /** Stops runs past their maximum duration; each ends timed out. */
  async enforceDeadlines(now: number): Promise<void> {
    const overdue = [...this.runs.values()].filter(
      (run) => !run.timedOut && run.startedAt !== null && now - run.startedAt > run.maxDurationMs,
    );
    await Promise.all(
      overdue.map(async (run) => {
        run.timedOut = true;
        this.deps.log.info('An automation run ran out of time; stopping it.', {
          automationId: run.automationId,
          taskId: run.taskId,
        });
        await this.deps.manager.cancel(run.taskId, run.runId).catch((error: unknown) => {
          this.deps.log.warn('Stopping a timed-out automation run failed.', {
            automationId: run.automationId,
            error: errorMessage(error),
          });
        });
      }),
    );
  }

  private onEvent(event: ServiceEvent): void {
    if (event.type !== 'run.status' || !event.runId) return;
    const run = this.runs.get(event.runId);
    if (!run || !RunStatusData.Check(event.data)) return;
    const { status, error } = event.data;
    if (isTerminalStatus(status)) this.end(run, status, error);
    else if (status !== 'queued') run.startedAt ??= this.deps.now();
  }

  /** Whether a run that ended is still settling. */
  get settling(): boolean {
    return this.ending.size > 0;
  }

  /** Resolves once every run that ended has settled. */
  async idle(): Promise<void> {
    while (this.ending.size) await Promise.all(this.ending.values());
  }

  private end(run: WatchedRun, status: RunStatus, error: string): void {
    if (this.ending.has(run.runId)) return;
    const settling = this.finish(run, status, error)
      .catch((failure: unknown) => {
        this.deps.log.warn('Settling an automation run failed.', {
          automationId: run.automationId,
          error: errorMessage(failure),
        });
      })
      .finally(() => {
        this.runs.delete(run.runId);
        this.ending.delete(run.runId);
        this.deps.released();
      });
    this.ending.set(run.runId, settling);
  }

  private async finish(run: WatchedRun, status: RunStatus, error: string): Promise<void> {
    const answer = status === 'completed' ? await this.answer(run) : '';
    const { declined, wrote } = await readUnattendedAudit(this.deps.auditDir, run.runId);
    await this.deps.ended(run, { status, error, answer, declined, wrote, timedOut: run.timedOut });
  }

  private async answer(run: WatchedRun): Promise<string> {
    try {
      return finalAnswer((await this.deps.manager.snapshot(run.taskId)).blocks, run.runId);
    } catch (error) {
      this.deps.log.warn('The answer of an automation run could not be read.', {
        automationId: run.automationId,
        error: errorMessage(error),
      });
      return '';
    }
  }
}
