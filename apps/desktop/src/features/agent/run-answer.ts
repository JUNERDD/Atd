import type { AgentEvent, TaskDetail } from '../../client/agent/bridge';
import { isActive, type RunStatus, type TaskRun } from '../../client/agent/task-schema';
import { applyTranscriptPatch, type Block } from '../../client/agent/transcript-schema';
import { lastAnswerText } from './transcript/final-answer';

/** Run `runId` of task `taskId` as `event` records it, when the event carries the task. */
function eventRun(event: AgentEvent, taskId: string, runId: string): TaskRun | undefined {
  const task =
    event.type === 'task'
      ? event.state.task
      : event.type === 'snapshot'
        ? event.snapshot.tasks.find((item) => item.id === taskId)
        : undefined;
  return task?.id === taskId ? task.runs.find((run) => run.id === runId) : undefined;
}

export function runStatus(event: AgentEvent, taskId: string, runId: string): RunStatus | undefined {
  return eventRun(event, taskId, runId)?.status;
}

/** Reconstructs one run's answer; consumers own output effects and partial-answer policy. */
export class RunAnswer {
  private transcript: { revision: number; blocks: Block[] } | null;
  text: string;
  private recovering = false;
  private terminal: RunStatus | undefined;
  /** Why the run ended as it did, as its record says once it ended ('' when it says nothing). */
  error = '';

  constructor(
    detail: TaskDetail,
    readonly runId: string,
    readonly taskId = detail.task.id,
  ) {
    this.transcript = { revision: detail.revision, blocks: detail.blocks };
    this.text = lastAnswerText(detail.blocks, runId);
  }

  get valid(): boolean {
    return this.transcript !== null;
  }

  /** A missing patch invalidates automatic output until a snapshot restores the transcript. */
  follow(event: AgentEvent): RunStatus | undefined {
    if (event.type === 'transcriptRecovery' && event.taskId === this.taskId) {
      this.transcript = null;
      this.recovering = event.state === 'loading';
    }
    if (event.type === 'transcript' && event.patch.taskId === this.taskId) {
      const base = this.transcript ?? (event.patch.snapshot ? { revision: 0, blocks: [] } : null);
      this.transcript = base && applyTranscriptPatch(base, event.patch);
      if (this.transcript) {
        this.recovering = false;
        this.text = lastAnswerText(this.transcript.blocks, this.runId);
      }
    }
    const run = eventRun(event, this.taskId, this.runId);
    if (run && !isActive(run.status)) {
      this.terminal = run.status;
      this.error = run.error;
    }
    return this.recovering ? undefined : this.terminal;
  }
}
