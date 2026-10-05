import path from 'node:path';
import {
  errorMessage,
  rootExecutionId,
  type ChildTranscriptResponse,
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
import type { ConfirmStore } from './confirms.js';
import { AuditWriter } from './audit.js';
import type { RunFolders } from './folders/material.js';
import { createReviewer } from './harness/auto-review.js';
import {
  applyRunToSession,
  createLiveState,
  NO_RUN_MATERIAL,
  type RunAttachment,
  type RunMaterial,
  type SessionFactoryDeps,
} from './pi-session.js';
import { prepareRunBinding } from './run-binding.js';
import { runPromptOptions, runPromptText } from './run-prompt.js';
import { freezeRunSelections, releaseRunSelections } from './run-freeze.js';
import type { LiveState } from './live-state.js';
import { lastAssistant } from './task-view.js';
import { runSkillsError } from './skills/run-skills.js';
import type { RuntimeAgent } from './subagents/agents.js';
import {
  abortSubagentsForTask,
  disposeSubagentsForTask,
  readChildTranscript,
  rebindSubagentsForRun,
} from './subagents/index.js';
import { LiveSlot } from './session-release.js';
import { replaceFollowUps } from './tasks/queue-replace.js';

export interface RunnerContext {
  ledger: Ledger;
  events: EventLog;
  confirms: ConfirmStore;
  capabilities: CapabilityRegistry;
  paths: ServicePaths;
  log: Logger;
  tier: PermissionTier;
}

/**
 * One Node runner per parent task. Owns run lifecycle, ledger status and
 * audit; staged selections freeze in run-freeze.ts, and Pi session assembly
 * lives in pi-session.ts.
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

  constructor(
    private readonly ctx: RunnerContext,
    readonly taskId: string,
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

  /** One child session's transcript (child-transcript-read.ts); null when the task has no such child. */
  async childTranscript(childKey: string): Promise<ChildTranscriptResponse | null> {
    const live = this.slot.live;
    const parentSessionFile = live?.sessionFile || this.ctx.ledger.task(this.taskId).sessionFile;
    if (!parentSessionFile) return null;
    return readChildTranscript({
      taskId: this.taskId,
      childKey,
      parentSessionFile,
      ...(live ? { parentBranch: () => live.manager.getBranch() } : {}),
      log: this.ctx.log,
    });
  }

  queueState(): QueueState {
    return this.slot.live?.transcript.queueState() ?? { steering: [], followUp: [] };
  }

  /** Executes one accepted run to a terminal ledger state; a failed folder read fails it. */
  async execute(run: TaskRun, attachments: RunAttachment[], folders: RunFolders): Promise<void> {
    this.currentRunId = run.id;
    this.aborted = false;
    this.audit = new AuditWriter(
      path.join(this.ctx.paths.auditDir, `${run.id}.jsonl`),
      this.ctx.log,
    );
    await this.setStatus(run.id, 'running', '');
    try {
      // T3/T4: skill, role, MCP and reference selections freeze once at
      // accept; the run's material and session binding come from them.
      const frozen = await freezeRunSelections(this.session, run);
      const blocked = runSkillsError(run, frozen.skills.loaded, frozen.catalog);
      if (blocked) {
        await this.setStatus(run.id, 'failed', blocked);
        return;
      }
      this.material = {
        instructions: run.snapshot.instructions,
        attachments,
        folders: await folders(),
        references: frozen.references.material,
        skills: frozen.skills.loaded,
        catalog: frozen.catalog,
        memory: frozen.memory,
      };
      const live = await this.ensureSession(run, frozen.agents);
      rebindSubagentsForRun(this.taskId, run);
      // Nothing in the text expands: `/skill:` markers reach the model as written,
      // and the skills themselves arrive in a hidden message (skills/session-skills.ts).
      await live.session.prompt(runPromptText(run), runPromptOptions(attachments));
      const last = lastAssistant(live.manager.getBranch());
      const failed = last?.stopReason === 'error';
      const error = failed ? (last.errorMessage ?? 'The model request failed.') : '';
      if (this.statusOf(run.id) === 'stopping' || this.aborted)
        await this.setStatus(run.id, 'stopped', '');
      else await this.setStatus(run.id, error ? 'failed' : 'completed', error);
    } catch (error) {
      if (error instanceof AuthRequired) {
        await this.setStatus(run.id, 'failed', `auth_required: ${error.message}`);
        return;
      }
      const state = this.statusOf(run.id);
      if (state === 'stopping' || this.aborted) await this.setStatus(run.id, 'stopped', '');
      else if (state !== 'cancelled' && state !== 'interrupted')
        await this.setStatus(run.id, 'failed', errorMessage(error));
    } finally {
      // Only the catalog and the memory sections outlive the run: a prompt the idle session sends
      // keeps its system prompt sections (skills/session-catalog.ts, memory/session-memory.ts);
      // attachment and skill text are let go.
      const { catalog, memory } = this.material;
      this.material = { ...NO_RUN_MATERIAL, catalog, memory };
      await releaseRunSelections(this.session, run.id);
      await this.audit?.flush();
    }
  }

  /** Stops the run and returns the queued messages it withdrew, undelivered. */
  async abort(runId: string): Promise<QueueState> {
    this.aborted = true;
    // Pi's abort keeps its queue, and the next prompt would deliver it into an
    // unrelated run; withdraw it first, as Pi's own Stop restores it to the editor.
    const unsent = this.slot.live?.session.clearQueue() ?? { steering: [], followUp: [] };
    await abortSubagentsForTask(this.taskId);
    await this.ctx.confirms.cancelRun(this.taskId, runId, 'Task stopped.');
    await this.ctx.capabilities.cancelRun(this.taskId, runId, 'Task stopped.');
    await this.slot.live?.session.abort();
    return unsent;
  }

  async queue(text: string, mode: 'followUp' | 'steer'): Promise<void> {
    const live = this.slot.live;
    if (!live || this.aborted) throw new Error('The task has no active run.');
    // Pi runs skill and template expansion on every queued entry, but with no
    // skills or prompt templates loaded, `/skill:` text stays as written.
    if (mode === 'followUp') await live.session.followUp(text);
    else await live.session.steer(text);
    this.withdrawIfStopped(live);
    // A steer is sent to be read now, so it cannot wait behind an approval or a question.
    if (mode === 'steer')
      await this.ctx.confirms.interject(
        this.taskId,
        () => live.session.getSteeringMessages().length > 0,
      );
  }

  async replaceQueue(followUp: string[]): Promise<QueueState> {
    const live = this.slot.live;
    if (!live || this.aborted) throw new Error('The task has no active run.');
    return live.transcript.batchQueue(async () => {
      const queue = await replaceFollowUps(live.session, followUp);
      this.withdrawIfStopped(live);
      return queue;
    });
  }

  /**
   * Stop withdraws the queue once, but an edit that was still validating or in
   * Pi's input handlers lands afterwards; take it back out so it cannot reach
   * a later run, and fail so the caller keeps its text.
   */
  private withdrawIfStopped(live: LiveState): void {
    if (!this.aborted) return;
    live.session.clearQueue();
    throw new Error('The task stopped before the message was queued.');
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

  private async setStatus(runId: string, status: RunStatus, error: string): Promise<void> {
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

  private async ensureSession(run: TaskRun, agents: RuntimeAgent[]): Promise<LiveState> {
    const binding = await prepareRunBinding(this.session, run, agents);
    // An idle or tier-change release still shutting the session down ends before it reopens. A
    // run stopped while it waited ends here, leaving the session untouched.
    await this.slot.settled();
    if (this.aborted) throw new Error('The run stopped before its session opened.');
    const live = this.slot.live;
    if (live && (await applyRunToSession(live, run, binding))) return live;
    // A changed run binding or another connection needs a new session;
    // reopen it from the same session file.
    await this.release();
    return this.slot.hold(await createLiveState(this.session, run, binding));
  }
}
