import { answersInPlace, type CommandOutput } from '@atd/agent-contracts';
import type {
  AgentEvent,
  PreparedCommand,
  TaskDetail,
  WriteTarget,
} from '../../client/agent/bridge';
import { isActive, type RunStatus } from '../../client/agent/task-schema';
import { RunAnswer } from './run-answer';

/** Command runs remembered at once, in this page only; the oldest is forgotten first. */
const MAX_RUNS = 32;

/**
 * A command run whose answer goes somewhere besides the conversation: the command's output and,
 * for a launch from another app, the field a write-back writes into (null once the shell reported
 * it gone).
 */
export interface CommandRun {
  taskId: string;
  runId: string;
  output: CommandOutput;
  target: WriteTarget | null;
}
/**
 * A run that ended while its answer still acted by itself: its final status, and the answer its
 * output acts on, empty unless it completed with one.
 */
export interface SettledCommandRun {
  run: CommandRun;
  status: RunStatus;
  answer: string;
}

interface Tracked {
  run: CommandRun;
  /**
   * Whether the answer still acts by itself once the run completes: copy, an unreviewed write, or
   * a light run's answer, which the island writes or shows for review.
   */
  pending: boolean;
  /**
   * The run's transcript as the stream patches it, followed only while `pending`: patches arrive
   * while the page holds the task, so a run that settles after the page moved off it, or after a
   * patch was missed, has none and its answer only stays in the conversation.
   */
  answer: RunAnswer | null;
}

const runs = new Map<string, Tracked>();
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}

/**
 * Remembers the run a command submit started (the newest run of the task `detail` describes) when
 * its answer goes somewhere: on the clipboard, or into or over the app the launch recorded
 * (`target`: a write-back, or the island's answer card). Either without a target leaves the answer
 * in the conversation, so it is not remembered.
 * `light` marks a run on the island (a light launch's, or a version of its review), whose end the
 * island reports even under review, since its review card shows the answer.
 */
export function trackCommandRun(
  prepared: PreparedCommand,
  detail: TaskDetail,
  light = false,
): void {
  const { output } = prepared;
  const target = answersInPlace(output.action) ? (prepared.target ?? null) : null;
  if (output.action !== 'copy' && !target) return;
  const run = detail.task.runs.at(-1);
  if (!run || runs.has(run.id)) return;
  const pending = (output.action === 'copy' || !output.review || light) && isActive(run.status);
  runs.set(run.id, {
    run: { taskId: detail.task.id, runId: run.id, output, target },
    pending,
    answer: pending ? new RunAnswer(detail, run.id) : null,
  });
  for (const runId of runs.keys()) {
    if (runs.size <= MAX_RUNS) break;
    runs.delete(runId);
  }
  changed();
}

/** The remembered command run `runId`, if any. The object changes only when the run's record does. */
export function commandRun(runId: string): CommandRun | undefined {
  return runs.get(runId)?.run;
}

export function subscribeCommandRuns(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The shell no longer knows the run's target, so nothing can be written there again. */
export function forgetCommandTarget(runId: string): void {
  const tracked = runs.get(runId);
  if (!tracked?.run.target) return;
  tracked.run = { ...tracked.run, target: null };
  changed();
}

/**
 * Follows remembered runs once per event. Failed, stopped, cancelled or invalid transcripts
 * leave their answers in the conversation; only completed valid answers act by themselves.
 */
export function followCommandRuns(event: AgentEvent): SettledCommandRun[] {
  const settled: SettledCommandRun[] = [];
  for (const tracked of runs.values()) {
    if (!tracked.pending || !tracked.answer) continue;
    const status = tracked.answer.follow(event);
    if (status === undefined) continue;
    const answer = status === 'completed' && tracked.answer.valid ? tracked.answer.text : '';
    tracked.pending = false;
    tracked.answer = null;
    settled.push({ run: tracked.run, status, answer });
  }
  return settled;
}
