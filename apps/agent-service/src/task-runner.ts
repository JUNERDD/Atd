import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  errorMessage,
  rootExecutionId,
  type PermissionTier,
  type RunStatus,
  type ServiceBlock,
  type TaskRun,
} from '@ai/agent-contracts';
import { AuthRequired } from './credentials.js';
import type { EventLog } from './event-log.js';
import { Ledger } from './ledger.js';
import type { Logger } from './logging.js';
import { McpAdapterMissing, McpAuthority } from './mcp/index.js';
import { freezeRunMcp, releaseRunMcp } from './mcp/staging.js';
import type { ServicePaths } from './storage.js';
import type { CapabilityRegistry } from './capabilities.js';
import type { ConfirmStore } from './confirms.js';
import { AuditWriter } from './audit.js';
import {
  applyRunToSession,
  createLiveState,
  type LiveState,
  type RunAttachment,
} from './pi-session.js';
import { ResourceStore } from './resources.js';
import { firstInvocationRunId, fromServiceBranch, projectServiceBlocks } from './transcript.js';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { decideExpansion } from './skills/expansion.js';
import { ensureSkillProfile, skillProfilePaths } from './skills/profile.js';
import { freezeRunRole } from './skills/roles.js';
import { takeTaskStaging } from './skills/staging.js';
import { freezeRunSkills, loadRunSnapshot, releaseRun } from './skills/versions.js';
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
 * audit; Pi session assembly lives in pi-session.ts. No subagents (T5).
 */
export class TaskRunner {
  private live: LiveState | null = null;
  private currentRunId = '';
  private aborted = false;
  private audit: AuditWriter | null = null;
  private readonly grants = new Set<string>();

  constructor(
    private readonly ctx: RunnerContext,
    readonly taskId: string,
  ) {}

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

  queueState(): { steering: string[]; followUp: string[] } {
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
      // T3: freeze skill/role snapshots once at accept; Pi wiring loads them.
      await this.freezeSkillsForRun(run);
      // MCP freeze alongside skills via the T4 snapshotter; runs bind tools
      // from the frozen revision, and config changes apply next run only.
      await this.freezeMcpForRun(run);
      const live = await this.ensureSession(run, attachments);
      rebindSubagentsForRun(this.taskId, run.id, run.snapshot.tools);
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
      await this.releaseSkillsForRun(run.id);
      await this.audit?.flush();
    }
  }

  async abort(runId: string): Promise<void> {
    this.aborted = true;
    await abortSubagentsForTask(this.taskId);
    await this.ctx.confirms.cancelRun(this.taskId, runId, 'Task stopped.');
    await this.ctx.capabilities.cancelRun(this.taskId, runId, 'Task stopped.');
    await this.live?.session.abort();
  }

  async queue(text: string, mode: 'followUp' | 'steer'): Promise<void> {
    const live = this.live;
    if (!live) throw new Error('The task has no active run.');
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
  }

  async replaceQueue(followUp: string[]): Promise<{ steering: string[]; followUp: string[] }> {
    return replaceFollowUps(
      { runId: this.currentRunId, session: this.live?.session ?? null, paths: this.ctx.paths },
      followUp,
    );
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

  private async freezeSkillsForRun(run: TaskRun): Promise<void> {
    // T3 additive freeze: staged next-run selection is consumed once; runs
    // without staging freeze empty skills + the default role (T1/T2 shape).
    const profile = skillProfilePaths(this.ctx.paths.root, this.ctx.paths.agentDir);
    await ensureSkillProfile(profile);
    const staging = await takeTaskStaging(profile, this.taskId);
    const skills = await freezeRunSkills(profile, run.id, staging.skills);
    await freezeRunRole(profile, {
      runId: run.id,
      roleId: staging.roleId,
      requestedTools: [...run.snapshot.tools],
      requestedSkills: skills.skills.map((skill) => skill.name),
    });
    this.audit?.append({
      taskId: this.taskId,
      runId: run.id,
      skillRevision: skills.revision,
      skillCount: skills.skills.length,
    });
  }

  private async releaseSkillsForRun(runId: string): Promise<void> {
    try {
      await releaseRun(skillProfilePaths(this.ctx.paths.root, this.ctx.paths.agentDir), runId);
      await releaseRunMcp(this.ctx.paths.root, runId);
    } catch (error) {
      this.ctx.log.warn('Run snapshot release failed.', {
        taskId: this.taskId,
        error: errorMessage(error),
      });
    }
  }

  private async freezeMcpForRun(run: TaskRun): Promise<void> {
    // MCP run freeze: captures the authority snapshot revision once at accept.
    // Pi binds proxies from this revision; later config edits bump the live
    // revision and apply next run. McpAdapterMissing degrades explicitly with
    // audit + warning; the run continues without MCP (never silent, never
    // fatal to skills).
    try {
      const serviceId = await readServiceId(this.ctx.paths);
      const authority = await McpAuthority.authorityFor({
        serviceId,
        dataDir: this.ctx.paths.root,
        agentDir: this.ctx.paths.agentDir,
        sessionsDir: this.ctx.paths.sessionsDir,
        cwd: this.ctx.paths.root,
        events: this.ctx.events,
        confirms: this.ctx.confirms,
        resources: new ResourceStore(this.ctx.ledger, this.ctx.paths),
        log: this.ctx.log,
      });
      const snapshot = authority.snapshot();
      const staged = await freezeRunMcp(this.ctx.paths.root, this.taskId, run.id);
      this.audit?.append({
        taskId: this.taskId,
        runId: run.id,
        mcpRevision: snapshot.revision,
        mcpServers: snapshot.servers.length,
        mcpStaged: staged ? staged.tools.length : null,
      });
    } catch (error) {
      if (!(error instanceof McpAdapterMissing)) throw error;
      this.ctx.log.warn('MCP freeze degraded: adapter is unavailable.', {
        taskId: this.taskId,
        error: errorMessage(error),
      });
      this.audit?.append({
        taskId: this.taskId,
        runId: run.id,
        mcpRevision: null,
        mcpDegraded: true,
      });
    }
  }

  private async ensureSession(run: TaskRun, attachments: RunAttachment[]): Promise<LiveState> {
    if (this.live) {
      await applyRunToSession(this.live, run);
      return this.live;
    }
    const live = await createLiveState(
      {
        ctx: this.ctx,
        taskId: this.taskId,
        currentRunId: () => this.currentRunId,
        executionId: () => this.executionId(),
        grants: this.grants,
        audit: (entry) => this.audit?.append(entry),
        setStatus: (runId, status) => {
          void this.setStatus(runId, status, '').catch(() => undefined);
        },
      },
      run,
      attachments,
    );
    this.live = live;
    return live;
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
