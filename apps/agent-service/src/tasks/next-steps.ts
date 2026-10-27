import { Compile } from 'typebox/compile';
import {
  errorMessage,
  RunStatusDataSchema,
  type AgentTask,
  type MessageUsage,
  type NextStep,
  type ServiceBlock,
  type ServiceEvent,
  type TaskNextSteps,
  type TaskRun,
} from '@atd/agent-contracts';
import { finalAnswer } from '../automations/outcome.js';
import { clip } from '../automations/prompt.js';
import type { EventLog } from '../event-log.js';
import type { Ledger } from '../ledger.js';
import type { Logger } from '../logging.js';
import type { ServicePaths } from '../storage.js';
import { readableInputText } from './input-chips.js';
import { UsedRequestError } from './next-steps-parse.js';
import type { NextStepMaterial } from './next-steps-model.js';

interface NextStepDeps {
  ledger: Ledger;
  events: Pick<EventLog, 'onPublish'>;
  paths: ServicePaths;
  log: Logger;
  enabled: () => boolean;
  /** The task's conversation as clients see it (task-view.ts), for the run's final answer. */
  blocks: (taskId: string) => Promise<readonly ServiceBlock[]>;
  /** Names of the person's saved automations, which a suggestion must not duplicate. */
  automations: () => readonly string[];
  notify: (taskId: string) => void;
}

/** The whole background job, including opening the model, ends by then without suggestions. */
const NEXT_STEPS_TIMEOUT_MS = 60_000;
const TIMED_OUT = Symbol('timed out');

/** Bounds of the material, together about 12k characters at most. */
const REQUESTS = 3;
const REQUEST_CHARS = 1200;
const ANSWER_HEAD_CHARS = 3000;
const ANSWER_TAIL_CHARS = 1500;
const RECENT_CONVERSATIONS = 30;
const RECENT_TITLE_CHARS = 60;
const AUTOMATION_NAMES = 20;
const AUTOMATION_NAME_CHARS = 60;

const RunStatusData = Compile(RunStatusDataSchema);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface Job {
  abort: AbortController;
  done: Promise<void>;
}

/**
 * Suggested next steps: one request per run of a person's own conversation that completed
 * normally. It owns no session or transcript and never affects its run. The write that completes
 * an eligible run also saves a pending marker (`markPending`, task-runner.ts `setStatus`), so the
 * conversation shows suggestions loading from the moment the run ends; the `completed` event then
 * starts the request. The answer replaces the marker, and no answer removes it, but only while the
 * marker is still pending for that run and the run is still the task's last and still completed:
 * accepting the task's next run withdraws both (accept-run.ts). A request stopped with the service
 * leaves its marker for recovery to clear (recovery.ts).
 */
export class NextStepJobs {
  private readonly jobs = new Map<string, Job>();
  private readonly unsubscribe: () => void;
  private stopped = false;

  constructor(private readonly deps: NextStepDeps) {
    this.unsubscribe = deps.events.onPublish((event) => this.onEvent(event));
  }

  /**
   * Called on the ledger draft that marks `run` completed: marks its suggestions pending when the
   * setting is on and the run is an eligible last run. Synchronous, so it lands in that write.
   */
  markPending(task: AgentTask, run: TaskRun): void {
    if (this.stopped || !this.deps.enabled() || task.runs.at(-1)?.id !== run.id) return;
    if (suggestsNextSteps(task, run)) task.nextSteps = { runId: run.id, status: 'pending' };
  }

  /**
   * What a run's status event adds: the marker `markPending` saved for `runId`, so clients receive
   * it with the status rather than in a later reload.
   */
  statusData(taskId: string, runId: string): { nextSteps?: TaskNextSteps } {
    const nextSteps = this.deps.ledger.data.tasks.find((task) => task.id === taskId)?.nextSteps;
    return nextSteps?.runId === runId ? { nextSteps } : {};
  }

  cancel(taskId: string): void {
    this.jobs.get(taskId)?.abort.abort();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.unsubscribe();
    for (const job of this.jobs.values()) job.abort.abort();
    await Promise.all([...this.jobs.values()].map((job) => job.done));
  }

  private onEvent(event: ServiceEvent): void {
    if (event.type !== 'run.status' || !event.runId || !RunStatusData.Check(event.data)) return;
    if (event.data.status === 'completed') this.start(event.taskId, event.runId);
  }

  private start(taskId: string, runId: string): void {
    if (this.stopped) return;
    const task = this.deps.ledger.data.tasks.find((item) => item.id === taskId);
    const run = task?.runs.at(-1);
    if (!task || !run || !pendingFor(task, runId)) return;
    this.cancel(taskId);
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(TIMED_OUT), NEXT_STEPS_TIMEOUT_MS);
    const job: Job = {
      abort,
      done: this.generate(task, run, abort.signal)
        .catch((error: unknown) => {
          this.deps.log.warn('Suggested next steps could not be saved.', {
            taskId,
            error: errorMessage(error),
          });
        })
        .finally(() => {
          clearTimeout(timer);
          if (this.jobs.get(taskId) === job) this.jobs.delete(taskId);
        }),
    };
    this.jobs.set(taskId, job);
  }

  private async generate(task: AgentTask, run: TaskRun, signal: AbortSignal): Promise<void> {
    let steps: NextStep[] = [];
    let usage: MessageUsage | undefined;
    let aborted: (() => void) | undefined;
    try {
      // Race the entire job: a provider or credential lookup that ignores cancellation cannot
      // hold a withdrawn suggestion or service shutdown past the deadline.
      const cancelled = new Promise<never>((_, reject) => {
        aborted = () => reject(new Error('Suggesting next steps was cancelled.'));
        signal.addEventListener('abort', aborted, { once: true });
        if (signal.aborted) aborted();
      });
      const completion = this.material(task, run).then(async (material) => {
        if (!material) return { steps: [], usage: undefined };
        const { generateNextSteps } = await import('./next-steps-model.js');
        return generateNextSteps(this.deps.paths, run, material, signal);
      });
      ({ steps, usage } = await Promise.race([completion, cancelled]));
    } catch (error) {
      // A reply that came back unusable was still paid for.
      if (error instanceof UsedRequestError) usage = error.usage;
      if (!signal.aborted || signal.reason === TIMED_OUT)
        this.deps.log.debug('No next steps were suggested.', {
          taskId: task.id,
          error: signal.aborted ? 'Timed out.' : errorMessage(error),
        });
    } finally {
      if (aborted) signal.removeEventListener('abort', aborted);
    }
    // Shutdown writes nothing more; recovery clears the marker the stopped request leaves.
    if (!this.stopped) await this.settle(task.id, run.id, signal.aborted ? [] : steps, usage);
  }

  /** What the request reads, or null when the run left no answer to build on. */
  private async material(task: AgentTask, run: TaskRun): Promise<NextStepMaterial | null> {
    const blocks = await this.deps.blocks(task.id);
    const answer = finalAnswer(blocks, run.id).trim();
    if (!answer) return null;
    // Runs with messages still on the conversation's branch; edited or regenerated ones left it.
    const prompted = new Set(
      blocks.flatMap((block) => (block.kind === 'user' ? [block.runId] : [])),
    );
    const requests = task.runs
      .filter((item) => item.id === run.id || prompted.has(item.id))
      .slice(-REQUESTS)
      .map((item) => clip(requestText(item), REQUEST_CHARS));
    const recent = this.deps.ledger.data.tasks
      .filter((item) => item.id !== task.id && isUserConversation(item))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, RECENT_CONVERSATIONS)
      .map((item) => `${localTime(item.createdAt)} · ${clip(item.title, RECENT_TITLE_CHARS)}`);
    const automations = this.deps
      .automations()
      .slice(0, AUTOMATION_NAMES)
      .map((name) => clip(name, AUTOMATION_NAME_CHARS));
    return {
      title: task.title,
      requests,
      answer: headAndTail(answer, ANSWER_HEAD_CHARS, ANSWER_TAIL_CHARS),
      recent,
      automations,
      now: localTime(new Date().toISOString()),
    };
  }

  /**
   * Records what the request used on its run, which a later run's withdrawal leaves in place, and
   * replaces the run's pending marker with its suggestions, or removes it when there are none.
   */
  private async settle(
    taskId: string,
    runId: string,
    items: NextStep[],
    usage: MessageUsage | undefined,
  ): Promise<void> {
    const changed = await this.deps.ledger.change((data) => {
      const task = data.tasks.find((item) => item.id === taskId);
      const run = task?.runs.find((item) => item.id === runId);
      const pending = pendingFor(task, runId);
      if (!pending && !(run && usage)) return false;
      if (run && usage) run.nextStepsUsage = usage;
      if (pending && items.length) task.nextSteps = { runId, status: 'ready', items };
      else if (pending) delete task.nextSteps;
      // Suggestions are metadata: keep the conversation's last activity time and list position.
      return true;
    });
    if (changed) this.deps.notify(taskId);
  }
}

/**
 * The task's suggestions are pending for `runId`, which is still its last run and still
 * completed.
 */
function pendingFor(task: AgentTask | undefined, runId: string): task is AgentTask {
  const last = task?.runs.at(-1);
  return (
    task?.nextSteps?.status === 'pending' &&
    task.nextSteps.runId === runId &&
    last?.id === runId &&
    last.status === 'completed'
  );
}

/** A person's own conversation, as opposed to an app's, an automation's, a subagent or a side chat. */
function isUserConversation(task: AgentTask): boolean {
  return task.rootTaskId === null && task.origin === undefined && task.sideChatOf === undefined;
}

/** Runs the person asked for themselves: not unattended, background or a lite command run. */
function suggestsNextSteps(task: AgentTask, run: TaskRun): boolean {
  const { trigger, lite, background } = run.snapshot;
  return isUserConversation(task) && !trigger && !lite && background !== true;
}

/** A run's request as the person wrote it, with its chips by name and its attachments listed. */
function requestText(run: TaskRun): string {
  const { input } = run.snapshot;
  const files = input.files.map((file) => file.name).join(', ');
  const text = [readableInputText(input).trim(), files ? `Attached files: ${files}` : '']
    .filter(Boolean)
    .join('\n');
  return text || '(no text)';
}

/** Keeps the opening of a long answer and its conclusion. */
function headAndTail(text: string, head: number, tail: number): string {
  if (text.length <= head + tail) return text;
  return `${text.slice(0, head)}\n[…]\n${text.slice(text.length - tail)}`;
}

/** `YYYY-MM-DD Ddd HH:MM` on the Mac's clock, so weekly cadences and times read at a glance. */
function localTime(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${day} ${WEEKDAYS[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
