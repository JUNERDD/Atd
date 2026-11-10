import type { AgentEvent, TaskDetail } from '../../client/agent/bridge';
import { isActive, type RunStatus } from '../../client/agent/task-schema';
import { applyTranscriptPatch, type Block } from '../../client/agent/transcript-schema';
import { lastAnswerText } from './transcript/final-answer';

export function runStatus(event: AgentEvent, taskId: string, runId: string): RunStatus | undefined {
  const task =
    event.type === 'task'
      ? event.state.task
      : event.type === 'snapshot'
        ? event.snapshot.tasks.find((item) => item.id === taskId)
        : undefined;
  return task?.id === taskId ? task.runs.find((run) => run.id === runId)?.status : undefined;
}

/** Reconstructs one run's answer; consumers own output effects and partial-answer policy. */
export class RunAnswer {
  private transcript: { revision: number; blocks: Block[] } | null;
  text: string;
  private recovering = false;
  private terminal: RunStatus | undefined;

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
    const status = runStatus(event, this.taskId, this.runId);
    if (status !== undefined && !isActive(status)) this.terminal = status;
    return this.recovering ? undefined : this.terminal;
  }
}
