import { forgetTaskTree, markParentStopping, rebindParentRun } from './registry.js';
import { abortTaskChildren } from './trigger.js';

/**
 * T5 run lifecycle wiring for TaskRunner (thin calls only). Parent stop maps
 * to stopping → no-new → parent abort → foreground interrupt → cleanup →
 * terminal → ledger; foreground never uses `action:stop`. Cancelling cannot
 * revoke remote side effects already committed by a child.
 */

/** Rebinds the parent record after a live session accepts a new run. */
export function rebindSubagentsForRun(taskId: string, runId: string, tools: string[]): void {
  rebindParentRun(taskId, runId, tools);
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

/** Drops registry state when a runner disposes (module cleanup per tree). */
export function disposeSubagentsForTask(taskId: string): void {
  forgetTaskTree(taskId);
}
