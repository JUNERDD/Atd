import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  errorMessage,
  rootExecutionId,
  type PermissionTier,
  type QueueState,
  type RunStatus,
  type ServiceBlock,
  type TaskRun,
} from '@ai/agent-contracts';
import { AuthRequired } from './credentials.js';
import type { EventLog } from './event-log.js';
import { Ledger } from './ledger.js';
import type { Logger } from './logging.js';
import type { ServicePaths } from './storage.js';
import type { CapabilityRegistry } from './capabilities.js';
import type { ConfirmStore } from './confirms.js';
import { AuditWriter } from './audit.js';
import {
  applyRunToSession,
  createLiveState,
  type LiveState,
  type RunAttachment,
  type RunMaterial,
  type SessionFactoryDeps,
} from './pi-session.js';
import { prepareRunBinding } from './run-binding.js';
import { freezeRunSelections, releaseRunSelections } from './run-freeze.js';
import { firstInvocationRunId, fromServiceBranch, projectServiceBlocks } from './transcript.js';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { decideExpansion } from './skills/expansion.js';
import { skillProfilePaths } from './skills/profile.js';
import { loadRunSnapshot } from './skills/versions.js';
import type { RuntimeAgent } from './subagents/agents.js';
import {
  abortSubagentsForTask,
  disposeSubagentsForTask,
  rebindSubagentsForRun,
} from './subagents/index.js';
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
  private live: LiveState | null = null;
  private currentRunId = '';
  private material: RunMaterial = { instructions: '', attachments: [], references: '' };
  private aborted = false;
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
      audit: (entry) => this.audit?.append(entry),
      setStatus: (runId, status) => {
        void this.setStatus(runId, status, '').catch(() => undefined);
      },
    };
  }

  executionId(): string {
    return rootExecutionId(this.currentRunId || 'pending');
  }

  isLive(): boolean {
    return this.live !== null;
  }

  async transcript(): Promise<{ revision: number; blocks: ServiceBlock[] }> {
    if (this.live) return this.live.transcript.snapshot();
    const task = this.ctx.ledger.task(this.taskId);
    if (!task.sessionFile) return { revision: 0, blocks: [] };
    try {
      const manager = SessionManager.open(
        task.sessionFile,
        path.join(this.ctx.paths.sessionsDir, this.taskId),
        this.ctx.paths.agentDir,
      );
      const branch = fromServiceBranch(manager.getBranch());
      return {
        revision: 0,
        blocks: projectServiceBlocks({
          branch,
          defaultRunId: firstInvocationRunId(branch) ?? this.taskId,
          live: false,
        }),
      };
    } catch (error) {
      this.ctx.log.warn('Cold transcript projection failed.', {
        taskId: this.taskId,
        error: errorMessage(error),
      });
      return { revision: 0, blocks: [] };
    }
  }

  queueState(): QueueState {
    return this.live?.transcript.queueState() ?? { steering: [], followUp: [] };
  }

  /** Executes one accepted run to a terminal ledger state. */
  async execute(run: TaskRun, attachments: RunAttachment[]): Promise<void> {
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
      const references = await freezeRunSelections(this.session, run);
      this.material = {
        instructions: run.snapshot.instructions,
        attachments,
        references: references.material,
      };
      const live = await this.ensureSession(run, references.agents);
      rebindSubagentsForRun(this.taskId, run);
      const entry = promptText(run);
      const decision = decideExpansion(
        entry,
        await loadRunSnapshot(
          skillProfilePaths(this.ctx.paths.root, this.ctx.paths.agentDir),
          run.id,
        ),
        run.id,
      );
      if (decision.isSkillCommand && !decision.allowed) {
        const message =
          decision.diagnostics[0]?.message ?? `Skill "${decision.skillName}" is not available.`;
        await this.setStatus(run.id, 'failed', message);
        return;
      }
      await live.session.prompt(entry, { expandPromptTemplates: decision.expandPromptTemplates });
      const last = [...live.session.messages]
        .reverse()
        .find((message) => message.role === 'assistant');
      const failed = last?.role === 'assistant' && last.stopReason === 'error';
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
      await releaseRunSelections(this.session, run.id);
      await this.audit?.flush();
    }
  }

  /** Stops the run and returns the queued messages it withdrew, undelivered. */
  async abort(runId: string): Promise<QueueState> {
    this.aborted = true;
    // Pi's abort keeps its queue, and the next prompt would deliver it into an
    // unrelated run; withdraw it first, as Pi's own Stop restores it to the editor.
    const unsent = this.live?.session.clearQueue() ?? { steering: [], followUp: [] };
    await abortSubagentsForTask(this.taskId);
    await this.ctx.confirms.cancelRun(this.taskId, runId, 'Task stopped.');
    await this.ctx.capabilities.cancelRun(this.taskId, runId, 'Task stopped.');
    await this.live?.session.abort();
    return unsent;
  }

  async queue(text: string, mode: 'followUp' | 'steer'): Promise<void> {
    const live = this.live;
    if (!live || this.aborted) throw new Error('The task has no active run.');
    // T3: Pi queue entries always expand in Pi, so explicit `/skill:name`
    // entries are pre-validated against the frozen snapshot; ordinary input
    // (no `/skill:` prefix) passes through without skill expansion.
    const snapshot = await loadRunSnapshot(
      skillProfilePaths(this.ctx.paths.root, this.ctx.paths.agentDir),
      this.currentRunId,
    );
    const decision = decideExpansion(text, snapshot, this.currentRunId);
    if (decision.isSkillCommand && !decision.allowed)
      throw new Error(
        decision.diagnostics[0]?.message ?? `Skill "${decision.skillName}" is not available.`,
      );
    if (mode === 'followUp') await live.session.followUp(text);
    else await live.session.steer(text);
    this.withdrawIfStopped(live);
  }

  async replaceQueue(followUp: string[]): Promise<QueueState> {
    const live = this.live;
    if (!live || this.aborted) throw new Error('The task has no active run.');
    return live.transcript.batchQueue(async () => {
      const queue = await replaceFollowUps(
        { runId: this.currentRunId, session: live.session, paths: this.ctx.paths },
        followUp,
      );
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
  async release(): Promise<void> {
    const live = this.live;
    this.live = null;
    if (!live) return;
    await live.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'new' });
    live.session.dispose();
  }

  async dispose(): Promise<void> {
    const live = this.live;
    this.live = null;
    if (live) {
      await live.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
      live.session.dispose();
    }
    disposeSubagentsForTask(this.taskId);
    await this.audit?.flush();
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
    if (this.live && (await applyRunToSession(this.live, run, binding))) return this.live;
    // A changed run binding or another connection needs a new session;
    // reopen it from the same session file.
    await this.release();
    this.live = await createLiveState(this.session, run, binding);
    return this.live;
  }
}

function promptText(run: TaskRun): string {
  return run.snapshot.input.text.trim() || run.snapshot.instructions || 'Use the attached context.';
}

export async function readServiceId(paths: ServicePaths): Promise<string> {
  const raw = JSON.parse(await readFile(paths.serviceFile, 'utf8')) as { serviceId?: unknown };
  if (typeof raw.serviceId !== 'string' || !raw.serviceId)
    throw new Error('Service identity is missing.');
  return raw.serviceId;
}
