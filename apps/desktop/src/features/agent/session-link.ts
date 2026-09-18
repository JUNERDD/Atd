import type { AgentTask } from '../../../electron/agent/task-schema';

/**
 * Copy payload for "copy session link".
 *
 * Pi 0.85.1 opens another session by absolute JSONL path: `pi --session <path|id>`
 * treats any value containing `/`, `\` or ending in `.jsonl` as a path and skips
 * the session-directory id lookup entirely (resolveSessionPath). Our per-task files
 * live under `<userData>/agent-v1/agent/sessions/<taskId>/`, outside Pi's default
 * lookup dirs, so a bare session id would never resolve there. Copy the ready to
 * paste CLI command when the worker has reported a session file, else the task id
 * so the session is still identifiable before its first run.
 */
export function sessionLinkText(task: Pick<AgentTask, 'id' | 'sessionFile'>): {
  text: string;
  withSession: boolean;
} {
  if (task.sessionFile) return { text: `pi --session "${task.sessionFile}"`, withSession: true };
  return { text: task.id, withSession: false };
}
