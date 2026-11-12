import type { AgentEvent, TaskDetail } from '../../client/agent/bridge';
import { isActive, type RunStatus } from '../../client/agent/task-schema';
import { RunAnswer, runStatus } from './run-answer';
import { lastAnswerText } from './transcript/final-answer';
import { agentApi } from './use-agent';

/** What following a run's answer reports. */
export interface AnswerHandlers {
  /** The answer so far changed while the run goes on (its text as it streams). */
  text?: (text: string) => void;
  /**
   * The run ended; an unrecoverable completed answer reports failed with its partial text.
   * `error` is why, as the run's record says ('' when it says nothing).
   */
  end: (status: RunStatus, answer: string, error: string) => void;
}

/**
 * Whether `event` shows run `runId` of task `taskId` waiting for the person: a question or a
 * confirmation, which only the panel can take.
 */
export function runWaits(event: AgentEvent, taskId: string, runId: string): boolean {
  const status = runStatus(event, taskId, runId);
  return (
    status === 'awaiting_input' ||
    status === 'awaiting_confirmation' ||
    (event.type === 'task' &&
      event.state.task.id === taskId &&
      event.state.requests.some((request) => request.runId === runId))
  );
}

/**
 * Follows the newest run of the task `detail` describes (a run whose task the page holds, so the
 * stream patches its transcript here) until it ends: `text` hears the answer as it grows, and
 * `end` once with the final status and answer. A run already over, or a task without one, ends
 * before this returns (a task without a run as `failed`: nothing will answer). Recovery waits
 * for the complete snapshot; if it fails, partial text remains available without claiming a
 * completed answer. Returns the unsubscribe; the follow also stops by itself at the end.
 */
export function followAnswer(detail: TaskDetail, handlers: AnswerHandlers): () => void {
  const run = detail.task.runs.at(-1);
  if (!run || !isActive(run.status)) {
    handlers.end(
      run?.status ?? 'failed',
      run ? lastAnswerText(detail.blocks, run.id) : '',
      run?.error ?? '',
    );
    return () => undefined;
  }
  const runId = run.id;
  const answer = new RunAnswer(detail, runId);
  let ended = false;
  const unsubscribe = agentApi().onChange((event) => {
    if (ended) return;
    const previous = answer.text;
    const status = answer.follow(event);
    if (answer.text !== previous) handlers.text?.(answer.text);
    if (status === undefined) return;
    ended = true;
    unsubscribe();
    // Failed, stopped and cancelled runs keep whatever they had produced.
    handlers.end(
      status === 'completed' && !answer.valid ? 'failed' : status,
      answer.text,
      answer.error,
    );
  });
  return () => {
    ended = true;
    unsubscribe();
  };
}
