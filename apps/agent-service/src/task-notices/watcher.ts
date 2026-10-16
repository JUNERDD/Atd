import { randomUUID } from 'node:crypto';
import { Compile } from 'typebox/compile';
import {
  ConfirmRequestedDataSchema,
  ConfirmResolvedDataSchema,
  errorMessage,
  MAX_TASK_NOTICE_OPTIONS,
  RunStatusDataSchema,
  type AgentTask,
  type PermissionRequest,
  type ServiceEvent,
  type TaskNotice,
  type TaskNoticeKind,
} from '@atd/agent-contracts';
import type { ConfirmStore } from '../confirms.js';
import type { EventLog } from '../event-log.js';
import type { Ledger } from '../ledger.js';
import type { Logger } from '../logging.js';
import type { RunnerManager } from '../runner-manager.js';
import { finalAnswer } from '../automations/outcome.js';
import { clip } from '../automations/prompt.js';
import type { TaskNoticeStore } from './store.js';

/**
 * Decides what happened to a task the person started that they may want to hear about while not
 * looking at it, and queues the notice; the shell decides whether anyone is looking. It reads the
 * event log the stream sends, so it sees what every client sees:
 *
 * - a question or approval (`confirm.requested`) still pending after `GRACE_MS` becomes
 *   `needsInput` / `needsConfirmation`, so one answered at once in the open panel never notifies;
 *   its answer or withdrawal (`confirm.resolved`) drops the timer and any unread notice. A
 *   question's suggested answers travel as the notice's `options`;
 * - a request whose notice was already served to the shell and that then resolves, whatever the
 *   outcome (answered, declined, expired, cancelled), becomes `resolved`, so the shell takes back
 *   the notification it may have shown; the store remembers served requests for that, bounded
 *   (see `TaskNoticeStore`);
 * - a run that `completed` after at least `MIN_COMPLETED_MS` becomes `completed`, with the opening
 *   of its final answer; a run that `failed` becomes `failed`, with its error. Other ends never
 *   notify: a stop was the person's own doing, and an interruption ends with the process.
 *
 * Automation tasks never notify here (their automation's notices cover them), nor does a run an
 * automation started (`trigger`); an app's task notifies only of its requests, since the app
 * consumes its results. A subagent's request notifies as its root task, the one the panel shows;
 * a subagent's own run end is part of the root run and never notifies.
 *
 * Write-back command runs are not told apart: the service records neither the launch surface nor
 * the output a run used (`RunSnapshot` keeps only `fromCommand` and the hidden instruction text,
 * which a panel launch of the same command gets too), so they notify like any run; the 15 s floor
 * and the shell's presence check keep that quiet in practice.
 */

/** How long a request waits for an answer in the open panel before it notifies. */
export const GRACE_MS = 5_000;
/** How long a run must have taken for its completion to notify. */
export const MIN_COMPLETED_MS = 15_000;

const TITLE_CHARS = 200;
const PREVIEW_CHARS = 500;
const OPTION_CHARS = 500;

const RunStatusData = Compile(RunStatusDataSchema);
const ConfirmRequestedData = Compile(ConfirmRequestedDataSchema);
const ConfirmResolvedData = Compile(ConfirmResolvedDataSchema);

export interface TaskNoticeWatcherDeps {
  events: Pick<EventLog, 'onPublish'>;
  ledger: Pick<Ledger, 'task' | 'run'>;
  confirms: Pick<ConfirmStore, 'pending'>;
  manager: Pick<RunnerManager, 'snapshot'>;
  store: TaskNoticeStore;
  /** A notice was queued: the shell should pull. */
  added: () => void;
  log: Logger;
  now: () => number;
}

export class TaskNoticeWatcher {
  /** Grace timers of pending requests, by request id. */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: TaskNoticeWatcherDeps) {}

  listen(): void {
    this.unsubscribe ??= this.deps.events.onPublish((event) => this.onEvent(event));
  }

  /** Stops listening and drops every grace timer; a completion still reading its answer is lost. */
  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private onEvent(event: ServiceEvent): void {
    if (event.type === 'confirm.requested' && ConfirmRequestedData.Check(event.data))
      this.requested(event.data.request);
    else if (event.type === 'confirm.resolved' && ConfirmResolvedData.Check(event.data))
      this.resolved(event.data.requestId);
    else if (event.type === 'run.status' && event.runId && RunStatusData.Check(event.data)) {
      const { status } = event.data;
      if (status === 'completed' || status === 'failed')
        this.ended(event.taskId, event.runId, status);
    }
  }

  private requested(request: PermissionRequest): void {
    if (!this.rootOf(request.taskId)) return;
    const timer = setTimeout(() => {
      this.timers.delete(request.id);
      this.stillPending(request.id);
    }, GRACE_MS);
    timer.unref();
    this.timers.set(request.id, timer);
  }

  private resolved(requestId: string): void {
    const timer = this.timers.get(requestId);
    if (timer) clearTimeout(timer);
    this.timers.delete(requestId);
    const served = this.deps.store.resolve(requestId);
    if (!served) return;
    this.queue({
      kind: 'resolved',
      taskId: served.taskId,
      taskTitle: served.taskTitle,
      request: served.request,
    });
  }

  /** The grace ended: notify of the request as it is now, if nobody answered it. */
  private stillPending(requestId: string): void {
    const live = this.deps.confirms.pending().find((item) => item.id === requestId);
    const root = live ? this.rootOf(live.taskId) : null;
    if (!live || !root) return;
    const kind: TaskNoticeKind = live.kind === 'input' ? 'needsInput' : 'needsConfirmation';
    const options = live.kind === 'input' ? cleanOptions(live.options) : [];
    this.add(kind, root, live.title, { id: live.id, revision: live.revision }, options);
  }

  private ended(taskId: string, runId: string, status: 'completed' | 'failed'): void {
    let task: AgentTask;
    try {
      task = this.deps.ledger.task(taskId);
    } catch {
      return;
    }
    // A subagent's run is part of its root's run; an app consumes its task's results.
    if (task.rootTaskId !== null || task.origin) return;
    const run = task.runs.find((item) => item.id === runId);
    if (!run || run.snapshot.trigger) return;
    if (status === 'failed') {
      this.add('failed', task, run.error);
      return;
    }
    if (this.deps.now() - Date.parse(run.createdAt) < MIN_COMPLETED_MS) return;
    void this.answer(taskId, runId).then((answer) => {
      // Closed while the answer was read: the service is stopping.
      if (this.unsubscribe) this.add('completed', task, answer);
    });
  }

  private async answer(taskId: string, runId: string): Promise<string> {
    try {
      return finalAnswer((await this.deps.manager.snapshot(taskId)).blocks, runId);
    } catch (error) {
      this.deps.log.warn('The answer of a finished task could not be read for its notice.', {
        error: errorMessage(error),
      });
      return '';
    }
  }

  /** The task a request of `taskId` notifies as, or null when its task gets no notices. */
  private rootOf(taskId: string): AgentTask | null {
    try {
      const task = this.deps.ledger.task(taskId);
      const root = task.rootTaskId === null ? task : this.deps.ledger.task(task.rootTaskId);
      return root.origin?.kind === 'automation' ? null : root;
    } catch {
      return null;
    }
  }

  private add(
    kind: TaskNoticeKind,
    task: AgentTask,
    text: string,
    request?: TaskNotice['request'],
    options: readonly string[] = [],
  ): void {
    const preview = clip(text, PREVIEW_CHARS);
    this.queue({
      kind,
      taskId: task.id,
      taskTitle: clip(task.title, TITLE_CHARS),
      ...(request ? { request } : {}),
      ...(preview ? { preview } : {}),
      ...(options.length > 0 ? { options: [...options] } : {}),
    });
  }

  private queue(notice: Omit<TaskNotice, 'id' | 'createdAt'>): void {
    this.deps.store.add({
      id: randomUUID(),
      ...notice,
      createdAt: new Date(this.deps.now()).toISOString(),
    });
    this.deps.added();
  }
}

/** A question's suggested answers as a notification can offer them: clipped, never empty. */
function cleanOptions(options: readonly string[]): string[] {
  return options
    .map((option) => clip(option, OPTION_CHARS))
    .filter((option) => option !== '')
    .slice(0, MAX_TASK_NOTICE_OPTIONS);
}
