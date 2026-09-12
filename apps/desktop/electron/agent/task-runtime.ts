import { Type } from 'typebox';
import path from 'node:path';
import type { AgentEvent, TaskDetail } from './bridge';
import { MemoryEntrySchema } from './bridge';
import {
  MessageSchema,
  isActive,
  type PermissionRequest,
  type TaskMessage,
  type TaskRun,
} from './task-schema';
import { AgentStore } from './store';
import { ContextResources } from './resources';
import { NativeTools } from './native-tools';
import { AgentWorker } from './worker-host';
import type { WorkerOutbound } from './worker-contract';
import { errorMessage } from './validation';

const RunResult = Type.Object({
  stopped: Type.Boolean(),
  error: Type.String(),
  sessionFile: Type.Optional(Type.String()),
});
interface RuntimeHost {
  publish: (event: AgentEvent) => void;
  changed: () => void;
  credential: (run: TaskRun) => string;
}

export class TaskRuntime {
  readonly worker: AgentWorker;
  readonly native: NativeTools;
  private messages = new Map<string, TaskMessage[]>();
  private requests = new Map<
    string,
    { request: PermissionRequest; resolve: (answer: string | boolean) => void }
  >();
  private executing = false;
  private closing = false;
  private revision = 0;
  error = '';
  constructor(
    readonly root: string,
    readonly store: AgentStore,
    readonly resources: ContextResources,
    private host: RuntimeHost,
  ) {
    this.native = new NativeTools(root, resources, {
      task: (id) => this.task(id),
      ask: (request) => this.ask(request),
      artifact: async (artifact) => {
        await store.change((data) => {
          data.artifacts.push(artifact);
        });
        this.publishTask(artifact.taskId);
      },
    });
    this.worker = new AgentWorker(root, {
      native: (request, onData) => this.native.execute(request, onData),
      event: (event) => this.event(event),
      failed: (message) => {
        void this.fail(message);
      },
    });
  }

  task(id: string) {
    const task = this.store.data.tasks.find((task) => task.id === id);
    if (!task) throw new Error('This task no longer exists.');
    return task;
  }

  cachedDetail(id: string): TaskDetail {
    return {
      task: this.task(id),
      messages: this.messages.get(id) ?? [],
      artifacts: this.store.data.artifacts.filter((file) => file.taskId === id),
      request:
        [...this.requests.values()].find((item) => item.request.taskId === id)?.request ?? null,
    };
  }

  async detail(id: string) {
    const task = this.task(id);
    if (!this.messages.has(id) && task.sessionFile) {
      await this.ready();
      this.messages.set(
        id,
        await this.worker.call(
          { action: 'messages', taskId: id, sessionFile: task.sessionFile },
          Type.Array(MessageSchema),
        ),
      );
    }
    return this.cachedDetail(id);
  }

  publishTask(id: string) {
    if (this.store.data.tasks.some((task) => task.id === id))
      this.host.publish({ type: 'task', revision: ++this.revision, detail: this.cachedDetail(id) });
    this.host.changed();
  }

  async ready() {
    try {
      await this.worker.start(this.store.data.memoryPaused);
      this.error = '';
    } catch (error) {
      this.error = errorMessage(error);
      this.host.changed();
      throw error;
    }
  }

  private async event(event: Exclude<WorkerOutbound, { type: 'response' | 'native' }>) {
    if (event.type === 'memoryChanged') {
      this.host.publish({ type: 'memory', snapshot: await this.memory() });
      return;
    }
    if (event.type === 'notice') {
      this.host.publish({ type: 'notice', notice: event });
      return;
    }
    if (event.type === 'question') {
      const answer = await this.ask(event.request);
      await this.worker.call(
        { action: 'answer', requestId: event.request.id, answer },
        Type.Null(),
      );
      return;
    }
    const task = this.task(event.taskId);
    if (!task.runs.some((run) => run.id === event.runId)) return;
    this.messages.set(task.id, event.messages);
    if (event.sessionFile && task.sessionFile !== event.sessionFile) {
      const directory = path.join(this.root, 'agent', 'sessions', task.id) + path.sep;
      if (!event.sessionFile.startsWith(directory))
        throw new Error('Invalid Agent session location.');
      await this.store.change((data) => {
        data.tasks.find((item) => item.id === task.id)!.sessionFile = event.sessionFile;
      });
    }
    this.publishTask(task.id);
  }

  async status(taskId: string, runId: string, status: TaskRun['status'], error = '') {
    await this.store.change((data) => {
      const task = data.tasks.find((task) => task.id === taskId);
      const run = task?.runs.find((run) => run.id === runId);
      if (!task || !run) return;
      run.status = status;
      run.error = error;
      task.updatedAt = new Date().toISOString();
    });
    this.publishTask(taskId);
  }

  async ask(request: PermissionRequest): Promise<string | boolean> {
    const run = this.task(request.taskId).runs.find((run) => run.id === request.runId);
    if (!run || !['running', 'awaiting_input', 'awaiting_confirmation'].includes(run.status))
      return false;
    const pending = new Promise<string | boolean>((resolve) =>
      this.requests.set(request.id, { request, resolve }),
    );
    try {
      await this.store.change((data) => {
        const active = data.tasks
          .find((task) => task.id === request.taskId)
          ?.runs.find((item) => item.id === request.runId);
        if (
          !active ||
          !['running', 'awaiting_input', 'awaiting_confirmation'].includes(active.status)
        )
          throw new Error('This request expired.');
        active.status = request.kind === 'input' ? 'awaiting_input' : 'awaiting_confirmation';
      });
      this.publishTask(request.taskId);
    } catch {
      this.requests.get(request.id)?.resolve(false);
      this.requests.delete(request.id);
    }
    return pending;
  }

  async answer(taskId: string, runId: string, id: string, answer: string | boolean) {
    const pending = this.requests.get(id);
    if (!pending || pending.request.taskId !== taskId || pending.request.runId !== runId)
      throw new Error('This request expired. Review the current task.');
    if (pending.request.kind === 'confirmation' && typeof answer !== 'boolean')
      throw new Error('Choose allow or decline.');
    if (pending.request.kind === 'input' && typeof answer === 'string' && !answer.trim())
      throw new Error('Enter a response.');
    await this.store.change((data) => {
      const task = data.tasks.find((task) => task.id === taskId);
      const run = task?.runs.find((run) => run.id === runId);
      if (
        !run ||
        !['running', 'awaiting_input', 'awaiting_confirmation'].includes(run.status) ||
        !this.requests.has(id)
      )
        throw new Error('This request expired. Review the current task.');
      const next = [...this.requests.values()].find(
        (item) => item.request.runId === runId && item.request.id !== id,
      )?.request;
      run.status = next
        ? next.kind === 'input'
          ? 'awaiting_input'
          : 'awaiting_confirmation'
        : 'running';
    });
    if (!this.requests.delete(id)) throw new Error('This request expired.');
    this.publishTask(taskId);
    pending.resolve(answer);
  }

  private dismiss(runId: string) {
    for (const [id, pending] of this.requests)
      if (pending.request.runId === runId) {
        this.requests.delete(id);
        pending.resolve(false);
      }
  }

  async stop(taskId: string, runId: string) {
    const run = this.task(taskId).runs.at(-1);
    if (run?.id !== runId || !isActive(run.status)) return;
    if (run.status === 'queued') {
      await this.status(taskId, runId, 'cancelled');
      return;
    }
    await this.status(taskId, runId, 'stopping');
    this.dismiss(runId);
    this.native.stop(runId);
    await this.worker.call({ action: 'stop', runId }, Type.Null());
  }

  async drain() {
    if (this.executing || this.closing) return;
    this.executing = true;
    try {
      let next;
      while (
        !this.closing &&
        (next = this.store.data.tasks
          .flatMap((task) =>
            task.runs.filter((run) => run.status === 'queued').map((run) => ({ task, run })),
          )
          .sort((a, b) => a.run.createdAt.localeCompare(b.run.createdAt))[0])
      ) {
        const { task, run } = next;
        try {
          const apiKey = this.host.credential(run);
          const files = await this.resources.resolve(run.snapshot.input.files);
          await this.ready();
          if (this.task(task.id).runs.find((item) => item.id === run.id)?.status !== 'queued')
            continue;
          await this.status(task.id, run.id, 'running');
          const result = await this.worker.call(
            {
              action: 'run',
              taskId: task.id,
              run,
              sessionFile: task.sessionFile,
              apiKey,
              attachments: files.map((file) => ({
                path: file.path,
                name: file.file.name,
                text: file.text,
              })),
            },
            RunResult,
          );
          this.dismiss(run.id);
          if (this.task(task.id).runs.find((item) => item.id === run.id)?.status === 'interrupted')
            continue;
          const stopped =
            this.task(task.id).runs.find((item) => item.id === run.id)?.status === 'stopping' ||
            result.stopped;
          await this.status(
            task.id,
            run.id,
            stopped ? 'stopped' : result.error ? 'failed' : 'completed',
            result.error,
          );
        } catch (error) {
          this.dismiss(run.id);
          this.native.stop(run.id);
          const state = this.task(task.id).runs.find((item) => item.id === run.id)?.status;
          if (state !== 'interrupted')
            await this.status(
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

  async memory() {
    try {
      await this.ready();
      return {
        entries: await this.worker.call({ action: 'memory' }, Type.Array(MemoryEntrySchema)),
        paused: this.store.data.memoryPaused,
        error: '',
      };
    } catch (error) {
      return { entries: [], paused: this.store.data.memoryPaused, error: errorMessage(error) };
    }
  }

  async forget(taskId: string) {
    if (this.messages.has(taskId))
      await this.worker.call({ action: 'forget', taskId }, Type.Null());
    this.messages.delete(taskId);
  }

  private async fail(message: string) {
    this.error = message;
    await this.store.change((data) => {
      for (const task of data.tasks)
        for (const run of task.runs)
          if (isActive(run.status)) {
            run.status = 'interrupted';
            run.error = message;
            this.dismiss(run.id);
            this.native.stop(run.id);
          }
    });
    this.host.changed();
  }

  async close() {
    this.closing = true;
    for (const task of this.store.data.tasks)
      for (const run of task.runs)
        if (isActive(run.status)) {
          this.dismiss(run.id);
          this.native.stop(run.id);
        }
    await this.worker.close();
  }
}
