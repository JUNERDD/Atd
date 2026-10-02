import { createContext, use } from 'react';
import type { TaskRun } from '../../../client/agent/task-schema';

/**
 * What a turn's actions need from the task the transcript shows and from the panel around it.
 * Only the task's own transcript provides it: a subagent's drill-in view has no message to replace
 * and no turn to regenerate or fork, so its turns offer none of those actions.
 */
export interface TaskTurns {
  taskId: string;
  title: string;
  runs: TaskRun[];
  /** A run is active: no message is replaced and no turn regenerated until it ends. */
  busy: boolean;
  /** Shows another task in the panel, as choosing it from the history does. */
  openTask?: ((taskId: string) => void) | undefined;
  /** Starts a memory session seeded with `text`. */
  remember?: ((text: string) => void) | undefined;
}

export const TaskTurnsContext = createContext<TaskTurns | null>(null);

/** The transcript's task, or null inside a subagent's view (and in isolated renders). */
export function useTaskTurns(): TaskTurns | null {
  return use(TaskTurnsContext);
}
