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

/** Owns FIFO dispatch and terminal outcomes; the task runtime owns interaction state. */
export class TaskQueue {
  private executing = false;
  closing = false;
  constructor(
    private runtime: TaskRuntime,
    private auth: (run: TaskRun) => Promise<AuthResult>,
  ) {}
  async drain() {
    if (this.executing || this.closing) return;
    this.executing = true;
    try {
      let next;
      while (
        !this.closing &&
        (next = this.runtime.store.data.tasks
          .flatMap((task) =>
            task.runs.filter((run) => run.status === 'queued').map((run) => ({ task, run })),
          )
          .sort((a, b) => a.run.createdAt.localeCompare(b.run.createdAt))[0])
      ) {
        const { task, run } = next;
        try {
          await this.auth(run);
          const files = await this.runtime.resources.resolve(run.snapshot.input.files);
          await this.runtime.ready();
          if (
            this.runtime.task(task.id).runs.find((item) => item.id === run.id)?.status !== 'queued'
          )
            continue;
          await this.runtime.status(task.id, run.id, 'running');
          const result = await this.runtime.worker.call(
            {
              action: 'run',
              taskId: task.id,
              run,
              sessionFile: task.sessionFile,
              attachments: files.map((file) => ({
                path: file.path,
                name: file.file.name,
                text: file.text,
              })),
            },
            RunResult,
          );
          this.runtime.dismiss(run.id);
          if (
            this.runtime.task(task.id).runs.find((item) => item.id === run.id)?.status ===
            'interrupted'
          )
            continue;
          const stopped =
            this.runtime.task(task.id).runs.find((item) => item.id === run.id)?.status ===
              'stopping' || result.stopped;
          await this.runtime.status(
            task.id,
            run.id,
            stopped ? 'stopped' : result.error ? 'failed' : 'completed',
            result.error,
          );
        } catch (error) {
          this.runtime.dismiss(run.id);
          this.runtime.native.stop(run.id);
          const state = this.runtime.task(task.id).runs.find((item) => item.id === run.id)?.status;
          if (state !== 'interrupted' && state !== 'cancelled')
            await this.runtime.status(
              task.id,
              run.id,
              state === 'stopping' ? 'stopped' : 'failed',
              errorMessage(error),
            );
        }
      }
    } finally {
      this.executing = false;
    }
  }
}
