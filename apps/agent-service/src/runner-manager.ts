import { randomUUID } from 'node:crypto';
import {
  errorMessage,
  isActiveStatus,
  type CancelRunResponse,
  type ChildTranscriptResponse,
  type ContextBreakdown,
  type PermissionTier,
  type SubmitTaskRequest,
  type SubmitTaskResponse,
  type TaskRun,
  type TaskSearchQuery,
  type TaskSearchResponse,
  type TaskSnapshot,
  type TaskSummary,
} from '@atd/agent-contracts';
import { runFolders } from './folders/material.js';
import type { FolderStore } from './folders/store.js';
import type { Logger } from './logging.js';
import { ResourceStore } from './resources.js';
import { loadRunAttachments } from './run-attachments.js';
import { compactRefused } from './compaction/manual.js';
import { ConflictError, DrainingError } from './errors.js';
import { SessionReleases } from './session-release.js';
import { TaskRunner, type RunnerContext } from './task-runner.js';
import {
  taskChildTranscript,
  taskContextBreakdown,
  taskSnapshot,
  taskSummary,
} from './task-view.js';
import { RunAcceptance } from './tasks/accept-run.js';
import { heldMessageInput } from './tasks/held-queue.js';
import { TaskSearch } from './tasks/search.js';
import type { InternalSubmitOptions } from './tasks/submit-options.js';
import type { TaskTitles } from './tasks/titles.js';

export interface ManagerDeps {
  ctx: RunnerContext;
  resources: ResourceStore;
  /** Folder grants: a submit grants its message's folders, a run reads them at its start. */
  folders: FolderStore;
  log: Logger;
  /** The shared settings' default tier, frozen onto each task at creation. */
  newTaskTier: () => PermissionTier;
  titles: TaskTitles;
  /** Idle time before a task's live session is released (session-release.ts `IDLE_RELEASE_MS`). */
  idleReleaseMs?: number;
}

/**
 * Accepts runs idempotently (tasks/accept-run.ts) and schedules them on per-task runners. The
 * service owns the ledger; runners own their Pi sessions, which `releases` closes once idle
 * (session-release.ts). Tasks run concurrently without a service-wide ceiling; within one task,
 * runs share a Pi session and start one at a time.
 */
export class RunnerManager {
  private readonly runners = new Map<string, TaskRunner>();
  private readonly executions = new Map<string, Promise<void>>();
  private draining = false;
  private dispatchPaused = false;
  private readonly acceptance: RunAcceptance;
  private readonly releases: SessionReleases;
  private readonly searcher: TaskSearch;

  constructor(private readonly deps: ManagerDeps) {
    this.acceptance = new RunAcceptance({
      ctx: deps.ctx,
      folders: deps.folders,
      newTaskTier: deps.newTaskTier,
      titles: deps.titles,
      runner: (taskId) => this.runners.get(taskId),
    });
    this.releases = new SessionReleases({
      ctx: deps.ctx,
      idleMs: deps.idleReleaseMs,
      draining: () => this.draining,
      runner: (taskId) => this.runners.get(taskId),
      executing: (runId) => this.executions.has(runId),
    });
    this.searcher = new TaskSearch({
      ledger: deps.ctx.ledger,
      log: deps.log,
      live: (taskId) => this.runners.get(taskId)?.liveState() ?? null,
    });
  }

  isDraining(): boolean {
    return this.draining;
  }

  /** An idle import holds new dispatches; background submissions may queue until it finishes. */
  pauseForDataImport(): () => void {
    if (
      this.draining ||
      this.dispatchPaused ||
      this.activeRunCount() ||
      this.executions.size ||
      [...this.runners.values()].some((runner) => runner.isCompacting())
    )
      throw new ConflictError('Finish active runs before syncing development data.');
    this.dispatchPaused = true;
    return () => {
      this.dispatchPaused = false;
      this.dispatch();
    };
  }

  activeRunCount(): number {
    let count = 0;
    for (const task of this.deps.ctx.ledger.data.tasks)
      for (const run of task.runs) if (isActiveStatus(run.status)) count += 1;
    return count;
  }

  runnerFor(taskId: string): TaskRunner {
    let runner = this.runners.get(taskId);
    if (!runner) {
      runner = new TaskRunner(this.deps.ctx, taskId, (runId) => this.startHeld(taskId, runId));
      this.runners.set(taskId, runner);
    }
    return runner;
  }

  /**
   * Idempotent acceptance; repeats return the original run, never a new one. `internal` carries
   * what only service code may set (an automation's origin, tier, title and trigger).
   */
  async submit(
    request: SubmitTaskRequest,
    internal: InternalSubmitOptions = {},
  ): Promise<SubmitTaskResponse> {
    if (this.draining) throw new DrainingError();
    const accepted = await this.acceptance.accept(request, internal);
    if (!accepted.duplicate) this.dispatch();
    return accepted;
  }

  /**
   * Stops a run and returns the queued messages it withdrew, undelivered: a started run's (the
   * runner's `abort`), or, for a run that has not started, what a lite run kept for it
   * (tasks/held-queue.ts); nothing else queues before a run starts.
   */
  async cancel(taskId: string, runId: string): Promise<CancelRunResponse> {
    const ledger = this.deps.ctx.ledger;
    const run = ledger.run(taskId, runId);
    const nothingQueued = { steering: [], followUp: [] };
    if (run.status === 'queued') {
      await ledger.change((data) => {
        const task = data.tasks.find((item) => item.id === taskId);
        const item = task?.runs.find((entry) => entry.id === runId);
        if (item) {
          item.status = 'cancelled';
          item.error = '';
        }
        if (task) task.updatedAt = new Date().toISOString();
      });
      this.deps.ctx.events.publish({
        taskId,
        runId,
        executionId: `root:${runId}`,
        type: 'run.status',
        data: { status: 'cancelled', error: '' },
      });
      const kept = this.runners.get(taskId)?.pending.held.withdraw() ?? [];
      return { task: ledger.task(taskId), unsent: { steering: [], followUp: kept } };
    }
    if (!isActiveStatus(run.status)) return { task: ledger.task(taskId), unsent: nothingQueued };
    await ledger.change((data) => {
      const item = data.tasks
        .find((entry) => entry.id === taskId)
        ?.runs.find((entry) => entry.id === runId);
      if (item) item.status = 'stopping';
    });
    this.deps.ctx.events.publish({
      taskId,
      runId,
      executionId: `root:${runId}`,
      type: 'run.status',
      data: { status: 'stopping', error: '' },
    });
    const unsent = await this.runnerFor(taskId).abort(runId);
    return { task: ledger.task(taskId), unsent };
  }

  async queue(taskId: string, text: string, mode: 'followUp' | 'steer'): Promise<void> {
    const task = this.deps.ctx.ledger.task(taskId);
    if (!task.runs.some((run) => isActiveStatus(run.status)))
      throw new Error('The task has no active run.');
    await this.runnerFor(taskId).pending.add(text, mode);
  }

  /** Discards a deleted task's runner and forgets it, so deleted tasks hold no runner. */
  async remove(taskId: string): Promise<void> {
    this.deps.titles.cancel(taskId);
    const runner = this.runners.get(taskId);
    this.releases.cancel(taskId);
    this.runners.delete(taskId);
    await runner?.discard();
  }

  snapshot(taskId: string): Promise<TaskSnapshot> {
    return taskSnapshot(this.deps.ctx, this.runners.get(taskId), taskId);
  }

  /** One child session's transcript (task-view.ts `taskChildTranscript`); null for none. */
  childTranscript(taskId: string, childKey: string): Promise<ChildTranscriptResponse | null> {
    return taskChildTranscript(this.deps.ctx, this.runners.get(taskId), taskId, childKey);
  }

  /** The task's context usage by category, from its live or stored session. */
  contextBreakdown(taskId: string): Promise<ContextBreakdown> {
    return taskContextBreakdown(this.deps.ctx, this.runners.get(taskId), taskId);
  }

  /** Tasks whose conversation holds every query term (tasks/search.ts), live sessions included. */
  search(query: TaskSearchQuery): Promise<TaskSearchResponse> {
    return this.searcher.search(query);
  }

  summary(taskId: string): TaskSummary {
    return taskSummary(this.deps.ctx, this.runners.get(taskId), taskId);
  }

  /** Every task's summary as of one stream position; synchronous, so no event lands in between. */
  summaries(): { tasks: TaskSummary[]; epoch: number; seq: number } {
    const { ledger, events } = this.deps.ctx;
    return {
      tasks: ledger.data.tasks.map((task) => this.summary(task.id)),
      epoch: events.epoch,
      seq: events.currentSeq,
    };
  }

  /**
   * Compacts an idle task's context now (task-runner.ts `compact`); refused while the task has a
   * run, queued ones included. Runs accepted meanwhile wait until the compaction ends.
   */
  async compact(taskId: string, instructions: string | undefined): Promise<void> {
    if (this.draining) throw new DrainingError();
    const task = this.deps.ctx.ledger.task(taskId);
    if (task.runs.some((run) => isActiveStatus(run.status)))
      throw compactRefused('active_run', 'Finish the active run before compacting the context.');
    const started = this.runnerFor(taskId).compact(instructions);
    const compaction = started.then(({ done }) => done);
    this.releases.busy(taskId, compaction);
    const { done } = await started;
    void done
      .catch((error: unknown) => {
        // The failure is the task's failed compaction block; the log keeps the cause.
        this.deps.log.warn('Manual compaction failed.', { taskId, error: errorMessage(error) });
      })
      .finally(() => this.dispatch());
  }

  dispatch(): void {
    if (this.draining || this.dispatchPaused) return;
    // A task's runs share one Pi session: only its oldest queued run starts, once no started run
    // is active (queued counts for acceptance, not dispatch) and no manual compaction holds the
    // session. A release still shutting the session down does not hold the run back: it freezes
    // and binds meanwhile, and reopens the session only once the release settles (run-prepare.ts
    // `openRunSession`). Tasks never wait on others.
    for (const task of this.deps.ctx.ledger.data.tasks) {
      if (task.runs.some((run) => run.status !== 'queued' && isActiveStatus(run.status))) continue;
      if (this.runners.get(task.id)?.isCompacting()) continue;
      const next = task.runs.find((run) => run.status === 'queued');
      if (next && !this.executions.has(next.id)) this.start(task.id, next);
    }
  }

  /**
   * Enters draining: no new runs, started runs abort, runners dispose. Queued runs never started,
   * so they stay `queued` in the ledger: draining keeps `dispatch` from starting them now, and the
   * next boot keeps them queued (recovery.ts) and dispatches them once the server listens.
   */
  async shutdown(): Promise<void> {
    this.draining = true;
    await this.deps.titles.stop();
    this.releases.cancelAll();
    const stopping: Promise<unknown>[] = [];
    for (const task of this.deps.ctx.ledger.data.tasks)
      for (const run of task.runs) {
        if (run.status !== 'queued' && isActiveStatus(run.status))
          stopping.push(this.cancel(task.id, run.id).catch(() => undefined));
      }
    await Promise.allSettled(stopping);
    await Promise.allSettled(this.executions.values());
    // Together: capped memory reviews (memory/learner) must not add up past the native stop budget.
    const disposing = [...this.runners].map(([taskId, runner]) =>
      runner.dispose().catch((error: unknown) => {
        this.deps.log.warn('Runner dispose failed.', { taskId, error: errorMessage(error) });
      }),
    );
    await Promise.all(disposing);
  }

  private start(taskId: string, run: TaskRun): void {
    const execution = this.run(taskId, run).finally(() => {
      this.executions.delete(run.id);
      this.dispatch();
    });
    this.executions.set(run.id, execution);
    this.releases.busy(taskId, execution);
  }

  private async run(taskId: string, run: TaskRun): Promise<void> {
    try {
      const attachments = await loadRunAttachments(
        this.deps.resources,
        run.snapshot.input.files,
        this.deps.log,
        taskId,
      );
      const folders = () => runFolders(this.deps.folders, taskId, this.deps.log);
      await this.runnerFor(taskId).execute(run, attachments, folders);
    } catch (error) {
      this.deps.log.warn('Run execution failed.', { taskId, error: errorMessage(error) });
    }
  }

  /**
   * Accepts the first message the task holds (tasks/held-queue.ts) as its next run, a plain message
   * of the user's own as the panel would submit it; that run's full session takes the rest. The
   * runner calls this before `runId` reports completed (task-runner.ts `beforeCompleted`), so the
   * run is accepted behind it and the task never looks idle in between: a message the user sends
   * meanwhile queues behind the held ones instead of starting a run that would answer it first.
   * The run starts once `runId`'s execution ends (`start`). A message whose run is not accepted
   * stays kept for the task's next run.
   */
  private async startHeld(taskId: string, runId: string): Promise<void> {
    const held = this.runners.get(taskId)?.pending.held;
    const text = held?.next();
    if (!held || text === undefined) return;
    const request = { operationId: randomUUID(), taskId, input: heldMessageInput(text) };
    try {
      await this.acceptance.accept(request, {}, runId);
    } catch (error) {
      held.putBack(text);
      this.deps.log.warn('A kept message could not start its run.', {
        taskId,
        error: errorMessage(error),
      });
    }
  }
}

export { ConflictError, DrainingError } from './errors.js';
