import type { LedgerData, RunStatus, StatusFrame } from '@ai/agent-contracts';

/** The counts a `status` frame carries. */
export type TaskStatusCounts = Omit<StatusFrame, 'type'>;

const WAITING: ReadonlySet<RunStatus> = new Set(['awaiting_input', 'awaiting_confirmation']);
const RUNNING: ReadonlySet<RunStatus> = new Set(['queued', 'running', 'stopping']);

/**
 * Root-task counts for status indicators (the contract is `StatusFrameSchema`). Each root task
 * counts at most once, attention first: a pending request or a latest run awaiting the user makes
 * it `attention`, otherwise a queued, running or stopping latest run makes it `running`. A task
 * with a `rootTaskId` never counts itself; its pending requests count toward that root.
 */
export function taskStatusCounts(
  data: Pick<LedgerData, 'tasks' | 'pendingConfirms'>,
): TaskStatusCounts {
  const rootOf = new Map(data.tasks.map((task) => [task.id, task.rootTaskId ?? task.id]));
  const requesting = new Set(
    data.pendingConfirms.map((request) => rootOf.get(request.taskId) ?? request.taskId),
  );
  let running = 0;
  let attention = 0;
  for (const task of data.tasks) {
    if (task.rootTaskId !== null) continue;
    const status = task.runs.at(-1)?.status;
    if (requesting.has(task.id) || (status !== undefined && WAITING.has(status))) attention += 1;
    else if (status !== undefined && RUNNING.has(status)) running += 1;
  }
  return { running, attention };
}
