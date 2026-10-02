import type { SummariesFrame } from '@atd/agent-contracts';
import type { TaskClient } from './service-tasks';

/**
 * Applies a `summaries` frame, the service's whole task set after a (re)subscribe it could not
 * replay. Tasks it does not list were deleted meanwhile; pending-request revisions are rebuilt from
 * the listed requests. The task list publishes once, then each task a view has loaded reloads its
 * transcript, since the events it missed are gone.
 */
export function applySummaries<S>(tasks: TaskClient<S>, frame: SummariesFrame): void {
  const listed = new Set(frame.tasks.map((summary) => summary.task.id));
  // Deleting the visited key while iterating a Map is safe: iteration goes on with the next key.
  for (const taskId of tasks.entries.keys()) if (!listed.has(taskId)) tasks.forget(taskId);
  tasks.revisions.clear();
  for (const summary of frame.tasks) tasks.storeSummary(summary);
  tasks.host.broadcast();
  for (const [taskId, entry] of tasks.entries)
    if (entry.transcript) void tasks.reloadTranscript(taskId).catch(() => undefined);
}
