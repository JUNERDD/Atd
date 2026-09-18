import { Type } from 'typebox';
import type { AuthResult } from '@earendil-works/pi-ai';
import type { TaskRuntime } from './task-runtime';
import type { TaskRun } from './task-schema';
import { errorMessage } from './validation';

const RunResult = Type.Object({
  stopped: Type.Boolean(),
  error: Type.String(),
  sessionFile: Type.Optional(Type.String()),
});

/** Starts every queued run without waiting for another run; per-task limits stay in RunService. */
export class RunDispatcher {
  closing = false;
  private readonly dispatching = new Set<string>();
  constructor(
    private runtime: TaskRuntime,
    private auth: (run: TaskRun) => Promise<AuthResult>,
  ) {}
  dispatch(): void {
    if (this.closing) return;
    for (const task of this.runtime.store.data.tasks)
      for (const run of task.runs)
        if (run.status === 'queued' && !this.dispatching.has(run.id)) {
          this.dispatching.add(run.id);
          void this.start(task.id, run)
            .catch((error) => {
              this.runtime.error = errorMessage(error);
              this.runtime.publishTask(task.id);
            })
            .finally(() => this.dispatching.delete(run.id));
        }
  }
  private async start(taskId: string, run: TaskRun) {
    try {
      await this.auth(run);
      const files = await this.runtime.resources.resolve(run.snapshot.input.files);
      await this.runtime.ready();
      if (this.status(taskId, run.id) !== 'queued') return;
      await this.runtime.status(taskId, run.id, 'running');
      const result = await this.runtime.worker.call(
        {
          action: 'run',
          taskId,
          run,
          sessionFile: this.runtime.task(taskId).sessionFile,
          attachments: files.map((file) => ({
            path: file.path,
            name: file.file.name,
            text: file.text,
          })),
        },
        RunResult,
      );
      this.runtime.dismiss(run.id);
      if (result.sessionFile) await this.runtime.rememberSession(taskId, result.sessionFile);
      this.runtime.resetQueue(taskId);
      if (this.status(taskId, run.id) === 'interrupted') {
        this.runtime.publishTask(taskId);
        return;
      }
      const stopped = this.status(taskId, run.id) === 'stopping' || result.stopped;
      // A stop the user asked for is not a failure: the abort text stays off the run.
      await this.runtime.status(
        taskId,
        run.id,
        stopped ? 'stopped' : result.error ? 'failed' : 'completed',
        stopped ? '' : result.error,
      );
    } catch (error) {
      this.runtime.dismiss(run.id);
      this.runtime.resetQueue(taskId);
      this.runtime.native.stop(run.id);
      const state = this.status(taskId, run.id);
      if (state === 'stopping') await this.runtime.status(taskId, run.id, 'stopped', '');
      else if (state !== 'interrupted' && state !== 'cancelled')
        await this.runtime.status(taskId, run.id, 'failed', errorMessage(error));
      else this.runtime.publishTask(taskId);
    }
  }
  private status(taskId: string, runId: string) {
    return this.runtime.task(taskId).runs.find((item) => item.id === runId)?.status;
  }
}
