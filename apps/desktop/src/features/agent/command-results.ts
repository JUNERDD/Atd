import { writesBack, type CommandOutput } from '@atd/agent-contracts';
import type {
  AgentEvent,
  PreparedCommand,
  TaskDetail,
  WriteTarget,
} from '../../client/agent/bridge';
import { isActive, type AgentTask, type RunStatus } from '../../client/agent/task-schema';
import {
  applyTranscriptPatch,
  type Block,
  type TranscriptPatch,
} from '../../client/agent/transcript-schema';
import { lastAnswerText } from './transcript/final-answer';

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
  /** Whether the answer still acts by itself once the run completes (copy, or an unreviewed write). */
  pending: boolean;
  /**
   * The run's transcript as the stream patches it, followed only while `pending`: patches arrive
   * while the page holds the task, so a run that settles after the page moved off it, or after a
   * patch was missed, has none and its answer only stays in the conversation.
   */
  transcript: { revision: number; blocks: Block[] } | null;
}

const EMPTY_TRANSCRIPT = { revision: 0, blocks: [] };
const runs = new Map<string, Tracked>();
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}

/**
 * Remembers the run a command submit started (the newest run of the task `detail` describes) when
 * its answer goes somewhere: on the clipboard, or into the app the launch recorded (`target`). A
 * write-back without a target leaves the answer in the conversation, so it is not remembered.
 */
export function trackCommandRun(prepared: PreparedCommand, detail: TaskDetail): void {
  const { output } = prepared.command;
  const target = writesBack(output.action) ? (prepared.target ?? null) : null;
  if (output.action !== 'copy' && !target) return;
  const run = detail.task.runs.at(-1);
  if (!run || runs.has(run.id)) return;
  const pending = (output.action === 'copy' || !output.review) && isActive(run.status);
  runs.set(run.id, {
    run: { taskId: detail.task.id, runId: run.id, output, target },
    pending,
    transcript: pending ? { revision: detail.revision, blocks: detail.blocks } : null,
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

function follow(patch: TranscriptPatch) {
  for (const tracked of runs.values()) {
    if (!tracked.pending || tracked.run.taskId !== patch.taskId) continue;
    // A snapshot patch replaces whatever was followed, so it also recovers a missed patch.
    const base = tracked.transcript ?? (patch.snapshot ? EMPTY_TRANSCRIPT : null);
    tracked.transcript = base && applyTranscriptPatch(base, patch);
  }
}

function settle(tasks: readonly AgentTask[]): SettledCommandRun[] {
  const settled: SettledCommandRun[] = [];
  for (const tracked of runs.values()) {
    if (!tracked.pending) continue;
    const task = tasks.find((item) => item.id === tracked.run.taskId);
    const status = task?.runs.find((run) => run.id === tracked.run.runId)?.status;
    if (status === undefined || isActive(status)) continue;
    // Failed, stopped and cancelled runs leave their answer in the conversation.
    const answer =
      status === 'completed' && tracked.transcript
        ? lastAnswerText(tracked.transcript.blocks, tracked.run.runId)
        : '';
    tracked.pending = false;
    tracked.transcript = null;
    settled.push({ run: tracked.run, status, answer });
  }
  return settled;
}

/**
 * Follows one agent event for the remembered runs and returns the runs it ended whose answer was
 * still to act by itself, each once; those with an answer now act on it. Transcript patches update
 * the answer; task states and snapshots report run status.
 */
export function followCommandRuns(event: AgentEvent): SettledCommandRun[] {
  if (event.type === 'transcript') follow(event.patch);
  else if (event.type === 'task') return settle([event.state.task]);
  else if (event.type === 'snapshot') return settle(event.snapshot.tasks);
  return [];
}
