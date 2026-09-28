import type { RunStatus } from './agent/task-schema';
import type { ConnectionState } from './service/connection';

/** What the menu bar status item shows, in priority order: the first that applies wins. */
export type MenuBarState = 'unavailable' | 'attention' | 'running' | 'idle';

export interface MenuBarStatus {
  state: MenuBarState;
  /** Tasks whose latest run is queued, running or stopping. */
  running: number;
  /** Tasks waiting for the user: input, a confirmation, or another pending request. */
  attention: number;
}

/** The slice of a cached task the status item reads. */
export interface MenuBarTask {
  status: RunStatus | undefined;
  pendingRequests: number;
}

const WAITING: ReadonlySet<RunStatus> = new Set(['awaiting_input', 'awaiting_confirmation']);
const RUNNING: ReadonlySet<RunStatus> = new Set(['queued', 'running', 'stopping']);

/**
 * Derives the status item's state. A service that is disconnected or reconnecting (the panel shows
 * its banner for both, and a stopped service stays reconnecting) makes every cached task status
 * stale, so it outranks them. Connecting keeps the last known task state, which avoids flashing
 * the unavailable state on every launch. The task list holds root tasks only, so a subagent's
 * work already counts toward its root task.
 */
export function menuBarStatus(
  tasks: readonly MenuBarTask[],
  connection: ConnectionState,
): MenuBarStatus {
  let running = 0;
  let attention = 0;
  for (const task of tasks) {
    if (task.pendingRequests > 0 || (task.status && WAITING.has(task.status))) attention += 1;
    else if (task.status && RUNNING.has(task.status)) running += 1;
  }
  const state: MenuBarState =
    connection === 'disconnected' || connection === 'reconnecting'
      ? 'unavailable'
      : attention > 0
        ? 'attention'
        : running > 0
          ? 'running'
          : 'idle';
  return { state, running, attention };
}

/**
 * The status item's tooltip. Main-process surfaces are English-only, like the application menu;
 * the renderer owns localized copy.
 */
export function menuBarTooltip(status: MenuBarStatus): string {
  if (status.state === 'unavailable') return 'AI · Service unavailable';
  const parts = [
    ...(status.running > 0 ? [`${status.running} running`] : []),
    ...(status.attention > 0 ? [`${status.attention} waiting for you`] : []),
  ];
  return ['AI', ...parts].join(' · ');
}
