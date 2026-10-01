import type { TaskContextState } from '@ai/agent-contracts';
import { isActive, type AgentTask } from '../../../client/agent/task-schema';

/** The service's cap on `/compact <focus>` instructions (`CompactTaskRequest`). */
export const MAX_COMPACT_INSTRUCTIONS = 2000;

/** Why a manual compaction cannot start; each maps to `quickPanel.blocked.*`. */
export type CompactBlock = 'noTask' | 'taskRunning' | 'compacting' | 'nothingToCompact';

/**
 * Mirrors the service's refusals so the entry points grey out instead of failing: no open task,
 * an active run (the service answers 409), a compaction already under way, or a task with no run
 * yet. The service stays authoritative; its own "nothing to compact" reason still reaches the
 * user as an error toast.
 */
export function compactBlock(
  task: AgentTask | null,
  context: TaskContextState | null,
): CompactBlock | null {
  if (!task) return 'noTask';
  if (task.runs.some((run) => isActive(run.status))) return 'taskRunning';
  if (context?.compacting) return 'compacting';
  if (task.runs.length === 0) return 'nothingToCompact';
  return null;
}
