import { randomUUID } from 'node:crypto';
import {
  errorMessage,
  isActiveStatus,
  type CancelRunResponse,
  type QueueState,
  type RunSnapshot,
  type SubmitTaskRequest,
  type SubmitTaskResponse,
  type TaskRun,
  type TaskSnapshot,
} from '@ai/agent-contracts';
import { ConnectionStore } from './credentials/connections.js';
import type { Logger } from './logging.js';
import { ResourceStore } from './resources.js';
import { ConflictError, DrainingError } from './errors.js';
import { TaskRunner, type RunnerContext } from './task-runner.js';
import { resolveRunModel, resolveRunThinkingLevel } from './tasks/run-selection.js';

/** First-round ceiling: at most two active parent tasks per service. */
const MAX_ACTIVE_PARENTS = 2;
const CONTEXT_BUDGET = 120000;

export interface ManagerDeps {
  ctx: RunnerContext;
  resources: ResourceStore;
  log: Logger;
}

/**
 * Accepts runs idempotently and schedules them on per-task runners. The
 * service owns the ledger; runners own their Pi sessions; queued work beyond
 * the parent ceiling waits instead of starting.
 */
export class RunnerManager {
  private readonly runners = new Map<string, TaskRunner>();
  private readonly executions = new Map<string, Promise<void>>();
  private draining = false;

  constructor(private readonly deps: ManagerDeps) {}

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

  /** Idempotent acceptance; repeats return the original run, never a new one. */
  async submit(request: SubmitTaskRequest): Promise<SubmitTaskResponse> {
    if (this.draining) throw new DrainingError();
    // Read before the checks below so acceptance stays free of awaits until the ledger write.
    const connections = await ConnectionStore.load(this.deps.ctx.paths.root);
    const ledger = this.deps.ctx.ledger;
    const duplicate = ledger.operation(request.operationId);
    if (duplicate) return { taskId: duplicate.taskId, runId: duplicate.runId, duplicate: true };
    const taskId = request.taskId ?? randomUUID();
    const previous = ledger.data.tasks.find((item) => item.id === taskId) ?? null;
    if (previous && request.taskId === undefined) {
      // A fresh uuid collided; retry once rather than merging into a stranger.
      return this.submit({ ...request, taskId: randomUUID() });
    }
    if (previous?.runs.some((run) => isActiveStatus(run.status)))
      throw new ConflictError('Finish the active run before starting a new one.');
    for (const file of request.input.files) {
      if (!ledger.data.resources.some((resource) => resource.id === file.id))
        throw new Error(`Attachment ${file.id} was not uploaded.`);
    }
    const snapshot = this.freezeSnapshot(request, connections);
    this.checkBudget(snapshot);
    const runId = randomUUID();
    const now = new Date().toISOString();
    await ledger.change((data) => {
      let task = data.tasks.find((item) => item.id === taskId);
      if (!task) {
        task = {
          id: taskId,
          title:
            snapshot.input.text.trim().slice(0, 120) ||
            snapshot.instructions.slice(0, 120) ||
            'New task',
          createdAt: now,
          updatedAt: now,
          sessionFile: null,
          runs: [],
          rootTaskId: null,
          parentExecutionId: null,
          // T6b: freeze the service default tier at creation (contract v1 shape).
          permissionTier: this.deps.ctx.tier,
        };
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
    });
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

  async snapshot(taskId: string): Promise<TaskSnapshot> {
    const task = this.deps.ctx.ledger.task(taskId);
    // runnerFor cold-projects from Pi JSONL when no live session exists, so
    // snapshots after a restart still carry the transcript without a runner.
    const runner = this.runnerFor(taskId);
    const document = await runner.transcript();
    const queue: QueueState = runner.queueState();
    return {
      task,
      revision: document.revision,
      blocks: document.blocks,
      requests: this.deps.ctx.confirms.forTask(taskId),
      capabilities: this.deps.ctx.capabilities.forTask(taskId),
      queue,
      epoch: this.deps.ctx.events.epoch,
      seq: this.deps.ctx.events.currentSeq,
    };
  }

  dispatch(): void {
    if (this.draining) return;
    // Only started runs hold a parent slot; a queued run must never block
    // itself (queued counts as active for acceptance, not for dispatch).
    const activeParents = new Set<string>();
    for (const task of this.deps.ctx.ledger.data.tasks)
      if (task.runs.some((run) => run.status !== 'queued' && isActiveStatus(run.status)))
        activeParents.add(task.id);
    for (const task of this.deps.ctx.ledger.data.tasks) {
      if (activeParents.size >= MAX_ACTIVE_PARENTS) return;
      for (const run of task.runs) {
        if (run.status !== 'queued' || this.executions.has(run.id)) continue;
        if (activeParents.has(task.id)) continue;
        activeParents.add(task.id);
        this.start(task.id, run);
        break;
      }
    }
  }

  /** Enters draining: no new runs, active trees abort, runners dispose. */
  async shutdown(): Promise<void> {
    this.draining = true;
    const stopping: Promise<unknown>[] = [];
    for (const task of this.deps.ctx.ledger.data.tasks)
      for (const run of task.runs) {
        if (run.status === 'queued') {
          stopping.push(
            this.deps.ctx.ledger
              .change((data) => {
                const item = data.tasks
                  .find((entry) => entry.id === task.id)
                  ?.runs.find((entry) => entry.id === run.id);
                if (item && item.status === 'queued') item.status = 'cancelled';
              })
              .catch((error: unknown) => {
                this.deps.log.warn('Drain cancel failed.', { error: errorMessage(error) });
              }),
          );
        } else if (isActiveStatus(run.status)) {
          stopping.push(this.cancel(task.id, run.id).catch(() => undefined));
        }
      }
    await Promise.allSettled(stopping);
    await Promise.allSettled([...this.executions.values()]);
    for (const runner of this.runners.values()) {
      await runner.dispose().catch((error: unknown) => {
        this.deps.log.warn('Runner dispose failed.', { error: errorMessage(error) });
      });
    }
  }

  private start(taskId: string, run: TaskRun): void {
    const execution = this.run(taskId, run).finally(() => {
      this.executions.delete(run.id);
      this.dispatch();
    });
    this.executions.set(run.id, execution);
  }

  private async run(taskId: string, run: TaskRun): Promise<void> {
    try {
      const attachments = [];
      for (const file of run.snapshot.input.files) {
        try {
          const { text } = await this.deps.resources.readText(file.id);
          attachments.push({ name: file.name, path: file.id, text });
        } catch (error) {
          this.deps.log.warn('Attachment unreadable; continuing without it.', {
            taskId,
            error: errorMessage(error),
          });
        }
      }
      await this.runnerFor(taskId).execute(run, attachments);
    } catch (error) {
      this.deps.log.warn('Run execution failed.', { taskId, error: errorMessage(error) });
    }
  }

  private freezeSnapshot(request: SubmitTaskRequest, connections: ConnectionStore): RunSnapshot {
    const model = resolveRunModel(connections, request.model);
    const thinkingLevel = resolveRunThinkingLevel(connections, model, request.thinkingLevel);
    return {
      input: request.input,
      instructions: '',
      model,
      tools: ['read', 'write', 'edit', 'bash', 'command'],
      // T1 runs without a memory authority; memory tools arrive with T2.
      memory: false,
      ...(thinkingLevel ? { thinkingLevel } : {}),
    };
  }

  private checkBudget(snapshot: RunSnapshot): void {
    const size =
      snapshot.input.text.length +
      snapshot.instructions.length +
      JSON.stringify(snapshot.input.arguments).length;
    if (size > CONTEXT_BUDGET)
      throw new Error('The combined input and parameters exceed the context budget.');
  }
}

export { ConflictError, DrainingError } from './errors.js';
