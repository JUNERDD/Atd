import type { TaskDetail } from '../../../client/agent/bridge';
import { showsAgentOutput } from '../transcript/turns';

/**
 * Where the panel's conversation stands relative to its reply:
 *
 * - `waiting`: a message is on its way or its run is queued or running with nothing to show yet,
 *   including the time the service spends before the model answers (a session rebuild, MCP tool
 *   listing, a pre-prompt compaction).
 * - `answering`: the run's first output is on screen. A block that shows nothing yet, such as an
 *   answer waiting on its first token, still counts as waiting.
 * - `idle`: no run is working on a reply, the run waits on the user (an approval or an answer),
 *   or the conversation has gone past its first run.
 * - `unknown`: the panel shows a conversation whose detail has not loaded yet, as just after a new
 *   task's submit settles; whatever showed before holds until it does.
 */
export type WaitPhase = 'waiting' | 'answering' | 'idle' | 'unknown';

/**
 * The phase of a new chat's first reply (`useNewChat`): `submitting` while the send that
 * starts it is in flight, `taskId` for the chat it opened (null when the panel shows anything
 * else), and the latest loaded detail, which may still be another task's. Only the chat's first
 * run counts: a follow-up is a new reply in an existing conversation.
 */
export function waitPhase(
  submitting: boolean,
  taskId: string | null,
  detail: TaskDetail | null,
): WaitPhase {
  if (submitting) return 'waiting';
  if (taskId === null) return 'idle';
  if (detail?.task.id !== taskId) return 'unknown';
  const { runs } = detail.task;
  const run = runs.length === 1 ? runs[0] : undefined;
  if (run?.status !== 'queued' && run?.status !== 'running') return 'idle';
  // The run's blocks close the transcript, so the scan stops at the first block of an earlier run.
  for (let index = detail.blocks.length - 1; index >= 0; index--) {
    const block = detail.blocks[index];
    if (!block || block.runId !== run.id) break;
    if (showsAgentOutput(block)) return 'answering';
  }
  return 'waiting';
}
