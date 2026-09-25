import type { TaskRun } from '@ai/agent-contracts';
import {
  forgetTaskTree,
  markParentStopping,
  rebindHostResources,
  rebindParentRun,
} from './registry.js';
import { forgetChildTranscripts } from './child-transcript.js';
import { abortTaskChildren } from './trigger.js';

/**
 * T5 run lifecycle wiring for TaskRunner (thin calls only). Parent stop maps
 * to stopping → no-new → parent abort → foreground interrupt → cleanup →
 * terminal → ledger; foreground never uses `action:stop`. Cancelling cannot
 * revoke remote side effects already committed by a child.
 */

/**
 * Rebinds the parent record and child host to the run a live session now
 * serves. A reused session keeps its session_start registration (role
 * ceiling, MCP proxies), which the run binding key pins; attachments change
 * with every run, so children read the current run's resources.
 */
export function rebindSubagentsForRun(taskId: string, run: TaskRun): void {
  rebindParentRun(taskId, run.id, run.snapshot.tools);
  rebindHostResources(
    taskId,
    run.snapshot.input.files.map((file) => file.id),
  );
}

/**
 * Aborts a task tree's foreground children after the parent abort. Marks the
 * parent stopping first so the guard admits nothing new, then interrupts only
 * this task's live children; sibling parents keep running.
 */
export async function abortSubagentsForTask(taskId: string): Promise<{ aborted: number }> {
  markParentStopping(taskId);
  return abortTaskChildren(taskId);
}

/** Drops registry state and live child transcripts when a runner disposes (cleanup per tree). */
export function disposeSubagentsForTask(taskId: string): void {
  forgetTaskTree(taskId);
  forgetChildTranscripts(taskId);
}
