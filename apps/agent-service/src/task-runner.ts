import path from 'node:path';
import { withInferencePurpose } from './providers/chatgpt-usage.js';
import { inferenceError } from './providers/inference-result.js';
import {
  errorMessage,
  isTerminalStatus,
  rootExecutionId,
  type PermissionTier,
  type QueueState,
  type RunStatus,
  type TaskRun,
} from '@atd/agent-contracts';
import {
  createCompactionState,
  compactRefused,
  NOTHING_TO_COMPACT,
  startManualCompaction,
} from './compaction/manual.js';
import { AuthRequired } from './credentials.js';
import type { EventLog } from './event-log.js';
import { Ledger } from './ledger.js';
import type { Logger } from './logging.js';
import type { ServicePaths } from './storage.js';
import type { CapabilityRegistry } from './capabilities.js';
import type { ComputerRuntime } from './computer/runtime.js';
import type { ConfirmStore } from './confirms.js';
import { AuditWriter } from './audit.js';
import type { RunFolders } from './folders/material.js';
import { createReviewer } from './harness/auto-review.js';
import type { SessionFactoryDeps } from './pi-session.js';
import { NO_RUN_MATERIAL, type RunAttachment, type RunMaterial } from './run-material.js';
import { runPromptOptions, runPromptText } from './run-prompt.js';
import { releaseRunSelections } from './run-freeze.js';
import type { LiveState } from './live-state.js';
import { lastAssistant } from './task-view.js';
import {
  abortSubagentsForTask,
  disposeSubagentsForTask,
  rebindSubagentsForRun,
} from './subagents/index.js';
import { LiveSlot } from './session-release.js';
import { TaskQueue } from './tasks/task-queue.js';
import {
  finishRunPreparation,
  promptWithPreparation,
  recordPreparationQueue,
  timePreparation,
  withRunPreparation,
} from './run-preparation-timing.js';

export interface RunnerContext {
  ledger: Ledger;
  events: EventLog;
  confirms: ConfirmStore;
  capabilities: CapabilityRegistry;
  /** Computer use: targets, action facts and the host coordinator (computer/runtime.ts). */
  computer: ComputerRuntime;
  paths: ServicePaths;
  log: Logger;
  tier: PermissionTier;
}

/**
 * One Node runner per parent task. Owns run lifecycle, ledger status and
 * audit; a run's material and session are prepared in run-prepare.ts, and Pi
 * session assembly lives in pi-session.ts and lite-session.ts.
 */
export class TaskRunner {
  /** The live session; a release serializes against reopening it (session-release.ts). */
  private readonly slot = new LiveSlot();
  private currentRunId = '';
  private material: RunMaterial = NO_RUN_MATERIAL;
  private aborted = false;
  /** The task was deleted (`discard`); its sessions read memory off from then on. */
  private deleted = false;
  /** A manual compaction of the idle session runs; runs wait for it. */
  private compacting = false;
  private audit: AuditWriter | null = null;
  private readonly grants = new Set<string>();
  /** Wiring for every Pi session this runner builds; accessors read the current run. */
  private readonly session: SessionFactoryDeps;
  /** What the user queued for the active run, until a run delivers it (tasks/task-queue.ts). */
  readonly pending: TaskQueue;

  /**
   * `beforeCompleted` runs once a run's prompt ended without an error or a Stop, before the run
   * reports completed: the runner manager accepts the task's next run from its held messages then
   * (runner-manager.ts `startHeld`), so the task is never seen idle while messages wait.
   */
  constructor(
    private readonly ctx: RunnerContext,
    readonly taskId: string,
    private readonly beforeCompleted: (runId: string) => Promise<void>,
  ) {
    this.session = {
      ctx,
      taskId,
      currentRunId: () => this.currentRunId,
      currentMaterial: () => this.material,
      executionId: () => this.executionId(),
      grants: this.grants,
      review: createReviewer({
        source: () => {
          const live = this.slot.live;
          if (!live) return null;
          const model = live.session.model ?? live.runModel.model;
          return { models: live.runModel.models, model, branch: () => live.manager.getBranch() };
        },
        runId: () => this.currentRunId,
        cwd: path.join(ctx.paths.tasksDir, taskId, 'output'),
        dataDir: ctx.paths.root,
        log: ctx.log,
      }),
      audit: (entry) => this.audit?.append(entry),
      setStatus: (runId, status) => {
        void this.setStatus(runId, status, '').catch(() => undefined);
      },
      stopRequested: () => this.aborted,
      deleted: () => this.deleted,
    };
    this.pending = new TaskQueue({
      live: () => this.slot.live,
      stopped: () => this.aborted,
      interject: (undelivered) => ctx.confirms.interject(taskId, undelivered),
      publish: (queue) =>
        ctx.events.publish({
          taskId,
          runId: this.currentRunId,
          executionId: this.executionId(),
          type: 'queue.update',
          data: queue,
        }),
    });
  }

  executionId(): string {
    return rootExecutionId(this.currentRunId || 'pending');
  }

  isLive(): boolean {
    return this.slot.live !== null;
  }

  /** A release is still shutting the live session down; nothing reopens it until that ends. */
  isReleasing(): boolean {
    return this.slot.releasing;
  }

  /** The live session; null while the task has none, when its views read the session file. */
  liveState(): LiveState | null {
    return this.slot.live;
  }

  isCompacting(): boolean {
    return this.compacting;
  }

  /**
   * Compacts the idle task's context now, on its live session or, without one, a session opened
   * for it on the latest run (compaction/manual.ts); see `startManualCompaction`. The caller
   * refuses while a run is active and holds new runs until it ends.
   */
  async compact(instructions: string | undefined): Promise<{ done: Promise<void> }> {
    if (this.compacting)
      throw compactRefused('already_compacting', 'The context is already being compacted.');
    const task = this.ctx.ledger.task(this.taskId);
    const run = task.runs.at(-1);
    if (!run || !(this.slot.live || task.sessionFile))
      throw compactRefused('nothing_to_compact', NOTHING_TO_COMPACT);
    // Events of a compaction outside a run belong to the task's latest run.
    this.currentRunId ||= run.id;
    this.compacting = true;
    return startManualCompaction({
      live: async () => {
        await this.slot.settled();
        return this.slot.live ?? this.slot.hold(await createCompactionState(this.session, run));
      },
      instructions,
      onEnd: () => {
        this.compacting = false;
      },
    });
  }

  /** Executes one accepted run to a terminal ledger state; a failed folder read fails it. */
  async execute(run: TaskRun, attachments: RunAttachment[], folders: RunFolders): Promise<void> {
    const task = this.ctx.ledger.task(this.taskId);
    // Older queued app runs have only their task origin. Only the first run came from the app;
    // subsequent user messages must not inherit that background purpose.
    const background =
      run.snapshot.background ??
      (run.snapshot.trigger !== undefined ||
        (task.origin?.kind === 'app' && task.runs[0]?.id === run.id));
    return withInferencePurpose(background, () =>
      withRunPreparation(this.taskId, run.id, this.session.audit, () =>
        this.executeRun(run, attachments, folders),
      ),
    );
  }

  private async executeRun(
    run: TaskRun,
    attachments: RunAttachment[],
    folders: RunFolders,
  ): Promise<void> {
    this.currentRunId = run.id;
    this.aborted = false;
    // A lite session answers only its own prompt; what is queued meanwhile waits (held-queue.ts).
    if (run.snapshot.lite) this.pending.held.start();
    this.audit = new AuditWriter(
      path.join(this.ctx.paths.auditDir, `${run.id}.jsonl`),
      this.ctx.log,
    );
    recordPreparationQueue(run.createdAt);
    try {
      await timePreparation('running_status', () => this.setStatus(run.id, 'running', ''));
      // Load the session and tool graph only for an executing run; failures settle this run below.
      const { openRunSession, prepareRun } = await timePreparation(
        'session_modules',
        () => import('./run-prepare.js'),
      );
      if (this.isStopping(run.id)) {
        await this.setStatus(run.id, 'stopped', '');
        return;
      }
      const prepared = await timePreparation('prepare_run', () =>
        prepareRun(this.session, run, attachments, folders),
      );
      if (prepared.blocked !== null) {
        await this.setStatus(run.id, 'failed', prepared.blocked);
        return;
      }
      this.material = prepared.material;
      const live = await openRunSession(
        { session: this.session, slot: this.slot, stopped: () => this.aborted },
        run,
        prepared.agents,
      );
      if (!run.snapshot.lite) await this.pending.held.handOver(live);
      rebindSubagentsForRun(this.taskId, run);
      // Nothing in the text expands: `/skill:` markers reach the model as written,
      // and the skills themselves arrive in a hidden message (skills/session-skills.ts).
      await promptWithPreparation(live.session, () =>
        live.session.prompt(runPromptText(run), runPromptOptions(attachments)),
      );
      const last = lastAssistant(live.manager.getBranch());
      const error = last ? (inferenceError(last) ?? '') : '';
      if (!error && !this.isStopping(run.id)) await this.beforeCompleted(run.id);
      if (this.isStopping(run.id)) await this.setStatus(run.id, 'stopped', '');
      else await this.setStatus(run.id, error ? 'failed' : 'completed', error);
    } catch (error) {
      if (error instanceof AuthRequired) {
        await this.setStatus(run.id, 'failed', `auth_required: ${error.message}`);
        return;
      }
      const state = this.statusOf(run.id);
      if (this.isStopping(run.id)) await this.setStatus(run.id, 'stopped', '');
      else if (state !== 'cancelled' && state !== 'interrupted')
        await this.setStatus(run.id, 'failed', errorMessage(error));
    } finally {
      finishRunPreparation(this.isStopping(run.id) ? 'stopped' : 'error');
      // Only the catalog, the memory sections and the view level outlive the run: a prompt the idle
      // session sends keeps its system prompt sections (skills/session-catalog.ts,
      // memory/session-memory.ts, views/tools.ts); attachment and skill text are let go.
      const { catalog, memory, viewInitiative } = this.material;
      this.material = { ...NO_RUN_MATERIAL, catalog, memory, viewInitiative };
      // A lite run froze nothing (run-prepare.ts).
      if (!run.snapshot.lite) await releaseRunSelections(this.session, run.id);
      // The host keeps per-run state (screen shares, previews, run-scoped browser profiles, target
      // preparation such as occlusion keep-alive) until it hears the run ended normally
      // (`finished`); an aborted run already told it through `abort`.
      if (!this.aborted)
        await this.ctx.computer.cancelRun(this.taskId, run.id, 'finished').catch(() => undefined);
      await this.audit?.flush();
    }
  }

  /** Stops the run and returns the queued messages it withdrew, undelivered. */
  async abort(runId: string): Promise<QueueState> {
    this.aborted = true;
    const unsent = this.pending.withdraw();
    await abortSubagentsForTask(this.taskId);
    await this.ctx.confirms.cancelRun(this.taskId, runId, 'Task stopped.');
    await this.ctx.capabilities.cancelRun(this.taskId, runId, 'Task stopped.');
    // Before the session's abort: the host is told to stop first, so the computer call that the
    // abort unblocks waits for the host's terminal reply instead of guessing.
    await this.ctx.computer.cancelRun(this.taskId, runId, 'stopped');
    await this.slot.live?.session.abort();
    return unsent;
  }

  /** Releases the idle session; reopening resumes from the same session file. */
  release(): Promise<void> {
    return this.slot.close('new');
  }

  /** Shuts the session down, after any release in flight, and drops the task's subagent state. */
  async dispose(): Promise<void> {
    await this.slot.close('quit');
    disposeSubagentsForTask(this.taskId);
    await this.audit?.flush();
  }

  /**
   * Disposes the runner of a deleted task. Marked first, so the closing session's memory already
   * reads off: its learner starts no shutdown review and aborts running ones at once, and the
   * store refuses what a review still commits (harness/memory-extension.ts).
   */
  async discard(): Promise<void> {
    this.deleted = true;
    await this.dispose();
  }

  private statusOf(runId: string): RunStatus {
    return this.ctx.ledger.run(this.taskId, runId).status;
  }

  /** Stop was requested for the run. */
  private isStopping(runId: string): boolean {
    return this.statusOf(runId) === 'stopping' || this.aborted;
  }

  private async setStatus(runId: string, status: RunStatus, error: string): Promise<void> {
    // The run's audit is complete before anyone hears it ended (audit.ts): the automation engine
    // reads its unattended declines and writes then (unattended.ts).
    if (isTerminalStatus(status)) await this.audit?.flush();
    await this.ctx.ledger.change((data) => {
      const task = data.tasks.find((item) => item.id === this.taskId);
      const run = task?.runs.find((item) => item.id === runId);
      if (!task || !run) return;
      run.status = status;
      run.error = error;
      task.updatedAt = new Date().toISOString();
    });
    this.ctx.events.publish({
      taskId: this.taskId,
      runId,
      executionId: rootExecutionId(runId),
      type: 'run.status',
      data: { status, error },
    });
  }
}
