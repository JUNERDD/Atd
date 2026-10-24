import { isDeepStrictEqual } from 'node:util';
import {
  isTerminalStatus,
  TASK_ACTIVITY_MAX_TERMINAL,
  TASK_ACTIVITY_TERMINAL_MS,
  type AgentTask,
  type ComputerActivity,
  type TaskActivityRun,
  type TaskActivitySnapshot,
  type TaskActivitySource,
  type TaskRun,
} from '@atd/agent-contracts';
import type { ComputerActivityBoard } from '../computer/activity.js';
import type { ComputerCoordinator } from '../computer/coordinator.js';
import type { Ledger } from '../ledger.js';
import { activityRequests } from './requests.js';
import type { TaskStepBoard } from './steps.js';

interface ProjectionDeps {
  board: ComputerActivityBoard;
  steps: TaskStepBoard;
  ledger: Ledger;
  coordinator: ComputerCoordinator;
  serviceId: string;
  epoch: number;
}

/**
 * Current/recent root task runs. A run joins once it is seen active in this epoch (so a restart
 * never lists old results), lifecycle comes only from the ledger, and steps and computer facts
 * are transient. The first terminal observation fixes its expiry, independent of subscribers or
 * connection loss; a task's next run replaces its row.
 */
export class TaskActivityProjection {
  private readonly seen = new Map<string, { taskId: string; runId: string }>();
  private readonly terminal = new Map<string, number>();
  private readonly listeners = new Set<(snapshot: TaskActivitySnapshot) => void>();
  private readonly unsubscribe: (() => void)[];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private snapshot: TaskActivitySnapshot;

  constructor(private readonly deps: ProjectionDeps) {
    this.snapshot = {
      serviceId: deps.serviceId,
      epoch: deps.epoch,
      revision: 0,
      hostState: deps.coordinator.hostStatus().state,
      runs: [],
    };
    this.unsubscribe = [
      deps.board.onChanged(() => this.refresh()),
      deps.steps.onChanged(() => this.refresh()),
      deps.ledger.onChanged(() => this.refresh()),
      deps.coordinator.onHostChanged(() => this.refresh()),
    ];
    this.refresh();
  }

  current(): TaskActivitySnapshot {
    return this.snapshot;
  }

  onChanged(listener: (snapshot: TaskActivitySnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    clearTimeout(this.timer);
    for (const unsubscribe of this.unsubscribe) unsubscribe();
    this.listeners.clear();
  }

  private refresh(): void {
    const now = Date.now();
    const { board, ledger, coordinator } = this.deps;
    for (const task of ledger.data.tasks) {
      const run = task.runs.at(-1);
      if (task.rootTaskId === null && run && !isTerminalStatus(run.status))
        this.see(task.id, run.id);
    }
    for (const observed of board.entries().values()) this.see(observed.taskId, observed.runId);
    const tasks = new Map(ledger.data.tasks.map((task) => [task.id, task]));
    const rows = new Map<string, TaskActivityRun>();
    for (const [key, { taskId, runId }] of this.seen) {
      const task = tasks.get(taskId);
      const run = task?.runs.at(-1);
      // A deleted task, a subagent's, or one whose next run took this row's place.
      if (!task || task.rootTaskId !== null || run?.id !== runId) {
        this.forget(key);
        continue;
      }
      const ended = isTerminalStatus(run.status);
      if (ended && !this.terminal.has(key)) this.terminal.set(key, now);
      const terminalAt = this.terminal.get(key);
      if (ended && terminalAt !== undefined && now - terminalAt >= TASK_ACTIVITY_TERMINAL_MS) {
        this.forget(key);
        continue;
      }
      rows.set(key, this.row(task, run, key, tasks, ended ? terminalAt : undefined));
    }
    const terminalRows = [...rows].filter(([, row]) => row.terminalAt !== undefined);
    terminalRows.sort((a, b) => (this.terminal.get(b[0]) ?? 0) - (this.terminal.get(a[0]) ?? 0));
    for (const [key] of terminalRows.slice(TASK_ACTIVITY_MAX_TERMINAL)) {
      this.forget(key);
      rows.delete(key);
    }
    this.scheduleExpiry(now, [...rows.values()]);
    const next = {
      ...this.snapshot,
      hostState: coordinator.hostStatus().state,
      runs: [...rows.values()],
    };
    if (isDeepStrictEqual(next, this.snapshot)) return;
    next.revision += 1;
    this.snapshot = next;
    for (const listener of this.listeners) listener(next);
  }

  private row(
    task: AgentTask,
    run: TaskRun,
    key: string,
    tasks: ReadonlyMap<string, AgentTask>,
    terminalAt?: number,
  ): TaskActivityRun {
    const { board, steps, ledger } = this.deps;
    const ended = terminalAt !== undefined;
    const requests = ended
      ? []
      : activityRequests(
          ledger.data.pendingConfirms,
          task,
          run,
          tasks,
          steps.viewCalls(task.id, run.id),
        );
    const step = ended ? undefined : steps.current(task.id, run.id);
    const observed = board.entries().get(key);
    const computer: ComputerActivity | undefined = observed && {
      operation: { ...observed.operation, inFlight: !ended && observed.operation.inFlight },
      ...(observed.target ? { target: observed.target } : {}),
      ...(observed.problem ? { problem: observed.problem } : {}),
    };
    const updatedAt =
      observed && observed.updatedAt > task.updatedAt ? observed.updatedAt : task.updatedAt;
    return {
      taskId: task.id,
      runId: run.id,
      title: task.title.slice(0, 1024),
      source: source(task, run),
      provider: run.snapshot.model.provider,
      status: run.status,
      startedAt: run.createdAt,
      updatedAt,
      ...(ended ? { terminalAt: new Date(terminalAt).toISOString() } : {}),
      requests,
      ...(step ? { step } : {}),
      ...(computer ? { computer } : {}),
    };
  }

  /** Map insertion order is the first-seen order, unchanged by later refreshes. */
  private see(taskId: string, runId: string): void {
    const key = `${taskId}/${runId}`;
    if (!this.seen.has(key)) this.seen.set(key, { taskId, runId });
  }

  private forget(key: string): void {
    this.seen.delete(key);
    this.deps.board.forget(key);
    this.terminal.delete(key);
  }

  private scheduleExpiry(now: number, rows: readonly TaskActivityRun[]): void {
    clearTimeout(this.timer);
    const next = Math.min(
      ...rows.flatMap((row) => (row.terminalAt ? [Date.parse(row.terminalAt)] : [])),
    );
    if (!Number.isFinite(next)) return;
    this.timer = setTimeout(
      () => this.refresh(),
      Math.max(1, next + TASK_ACTIVITY_TERMINAL_MS - now),
    );
    this.timer.unref();
  }
}

function source(task: AgentTask, run: TaskRun): TaskActivitySource {
  if (task.origin?.kind === 'automation' || run.snapshot.trigger) return 'automation';
  if (task.origin?.kind === 'app') return 'app';
  return run.snapshot.fromCommand ? 'command' : 'conversation';
}
