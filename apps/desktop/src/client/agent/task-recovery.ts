import type { TaskDetail } from './bridge';
import type { TaskHost } from './service-tasks';

/** Transcript recovery signals let answer consumers wait without hiding the task's real state. */
export class TaskRecovery {
  private readonly waiting = new Set<string>();

  begin(taskId: string, host: TaskHost): void {
    if (this.waiting.has(taskId)) return;
    this.waiting.add(taskId);
    host.emit({ type: 'transcriptRecovery', taskId, state: 'loading' });
  }

  async load(taskId: string, host: TaskHost, load: () => Promise<void>): Promise<void> {
    this.begin(taskId, host);
    try {
      await load();
    } catch (error) {
      if (this.waiting.delete(taskId))
        host.emit({ type: 'transcriptRecovery', taskId, state: 'failed' });
      throw error;
    }
  }

  forget(taskId: string): void {
    this.waiting.delete(taskId);
  }

  clear(): void {
    this.waiting.clear();
  }

  /** Publish the complete answer before terminal status can release the last task hold. */
  publish(detail: TaskDetail, loaded: boolean, host: TaskHost): void {
    if (loaded)
      host.emit({
        type: 'transcript',
        patch: {
          taskId: detail.task.id,
          revision: detail.revision,
          snapshot: true,
          blocks: detail.blocks,
          removed: [],
        },
      });
    this.forget(detail.task.id);
  }
}
