import { randomUUID } from 'node:crypto';
import {
  errorMessage,
  isActiveStatus,
  type CancelRunResponse,
  type ContextBreakdown,
  type PermissionTier,
  type SubmitTaskRequest,
  type SubmitTaskResponse,
  type TaskRun,
  type TaskSnapshot,
  type TaskSummary,
} from '@atd/agent-contracts';
import { ConnectionStore } from './credentials/connections.js';
import { runFolders } from './folders/material.js';
import type { FolderStore } from './folders/store.js';
import type { Logger } from './logging.js';
import { ResourceStore } from './resources.js';
import { loadRunAttachments } from './run-attachments.js';
import { compactRefused } from './compaction/manual.js';
import { ConflictError, DrainingError } from './errors.js';
import { SessionReleases } from './session-release.js';
import { TaskRunner, type RunnerContext } from './task-runner.js';
import { taskContextBreakdown, taskSnapshot, taskSummary } from './task-view.js';
import { checkChipRanges } from './tasks/input-chips.js';
import {
  branchUserEntries,
  checkBranchBefore,
  freezeRunSnapshot,
  loadSubmitContextWindow,
} from './tasks/run-snapshot.js';
import {
  checkSideChatOf,
  newTaskRecord,
  type InternalSubmitOptions,
} from './tasks/submit-options.js';

export interface ManagerDeps {
  ctx: RunnerContext;
  resources: ResourceStore;
  /** Folder grants: a submit grants its message's folders, a run reads them at its start. */
  folders: FolderStore;
  log: Logger;
  /** The shared settings' default tier, frozen onto each task at creation. */
  newTaskTier: () => PermissionTier;
  /** Idle time before a task's live session is released (session-release.ts `IDLE_RELEASE_MS`). */
  idleReleaseMs?: number;
}

/**
 * Accepts runs idempotently and schedules them on per-task runners. The service owns the ledger;
 * runners own their Pi sessions, which `releases` closes once idle (session-release.ts). Tasks run
 * concurrently without a service-wide ceiling; within one task, runs share a Pi session and start
 * one at a time.
 */
export class RunnerManager {
  private readonly runners = new Map<string, TaskRunner>();
  private readonly executions = new Map<string, Promise<void>>();
  private draining = false;
  /**
   * Tasks whose accepted run is still being written. The ledger publishes a change only after its
   * write lands, so without this two submits to one task could both pass the active-run check,
   * and a replacing run (`branchBefore`) could then cut the other off the branch.
   */
  private readonly accepting = new Set<string>();
  private readonly releases: SessionReleases;

  constructor(private readonly deps: ManagerDeps) {
    this.releases = new SessionReleases({
      ctx: deps.ctx,
      idleMs: deps.idleReleaseMs,
      draining: () => this.draining,
      runner: (taskId) => this.runners.get(taskId),
      executing: (runId) => this.executions.has(runId),
    });
  }

  isDraining(): boolean {
    return this.draining;
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
      runner = new TaskRunner(this.deps.ctx, taskId);
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
    checkChipRanges(request.input);
    // Read before the checks below so acceptance stays free of awaits until the ledger write.
    const connections = await ConnectionStore.load(this.deps.ctx.paths.root);
    const ledger = this.deps.ctx.ledger;
    const last = ledger.data.tasks.find((item) => item.id === request.taskId)?.runs.at(-1);
    const contextWindowOf = await loadSubmitContextWindow(connections, request, last);
    const onBranch = await branchUserEntries(
      this.deps.ctx,
      this.runners.get(request.taskId ?? ''),
      request,
    );
    const duplicate = ledger.operation(request.operationId);
    if (duplicate) return { taskId: duplicate.taskId, runId: duplicate.runId, duplicate: true };
    const taskId = request.taskId ?? randomUUID();
    const previous = ledger.data.tasks.find((item) => item.id === taskId) ?? null;
    if (previous && request.taskId === undefined) {
      // A fresh uuid collided; retry once rather than merging into a stranger.
      return this.submit({ ...request, taskId: randomUUID() }, internal);
    }
    if (previous?.runs.some((run) => isActiveStatus(run.status)) || this.accepting.has(taskId))
      throw new ConflictError('Finish the active run before starting a new one.');
    checkBranchBefore(request.branchBefore, onBranch);
    const { sideChatOf } = request;
    checkSideChatOf(sideChatOf, previous, ledger.data.tasks);
    for (const file of request.input.files) {
      if (!ledger.data.resources.some((resource) => resource.id === file.id))
        throw new Error(`Attachment ${file.id} was not uploaded.`);
    }
    const folderIds = request.input.folders ?? [];
    this.deps.folders.resolve(folderIds);
    const snapshot = freezeRunSnapshot(
      request,
      connections,
      contextWindowOf,
      previous,
      onBranch,
      internal.trigger,
    );
    const runId = randomUUID();
    const now = new Date().toISOString();
    this.accepting.add(taskId);
    // Granted before the run exists, so no dispatch can start it without its folders.
    await this.deps.folders.grant(taskId, folderIds).catch((error: unknown) => {
      this.accepting.delete(taskId);
      throw error;
    });
    await ledger
      .change((data) => {
        let task = data.tasks.find((item) => item.id === taskId);
        if (!task) {
          const tier = this.deps.newTaskTier();
          task = newTaskRecord({ id: taskId, now, snapshot, tier, sideChatOf, internal });
          data.tasks.unshift(task);
        }
        task.runs.push({
          id: runId,
          operationId: request.operationId,
          createdAt: now,
          status: 'queued',
          error: '',
          snapshot,
        });
        task.updatedAt = now;
        data.operations[request.operationId] = { taskId, runId };
      })
      .finally(() => this.accepting.delete(taskId));
    this.deps.ctx.events.publish({
      taskId,
      runId,
      executionId: `root:${runId}`,
      type: 'run.status',
      data: { status: 'queued', error: '' },
    });
    this.dispatch();
    return { taskId, runId, duplicate: false };
  }

  /** Stops a run; only a live run can hold undelivered queued messages to return. */
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
      return { task: ledger.task(taskId), unsent: nothingQueued };
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
    await this.runnerFor(taskId).queue(text, mode);
  }

  /** Discards a deleted task's runner and forgets it, so deleted tasks hold no runner. */
  async remove(taskId: string): Promise<void> {
    const runner = this.runners.get(taskId);
    this.releases.cancel(taskId);
    this.runners.delete(taskId);
    await runner?.discard();
  }

  snapshot(taskId: string): Promise<TaskSnapshot> {
    return taskSnapshot(this.deps.ctx, this.runners.get(taskId), taskId);
  }

  /** The task's context usage by category, from its live or stored session. */
  contextBreakdown(taskId: string): Promise<ContextBreakdown> {
    return taskContextBreakdown(this.deps.ctx, this.runners.get(taskId), taskId);
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
    if (this.draining) return;
    // A task's runs share one Pi session: only its oldest queued run starts, once no started run
    // is active (queued counts for acceptance, not dispatch) and no manual compaction holds the
    // session. A release still shutting the session down does not hold the run back: it freezes
    // and binds meanwhile, and reopens the session only once the release settles (task-runner.ts
    // `ensureSession`). Tasks never wait on others.
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
}

export { ConflictError, DrainingError } from './errors.js';
