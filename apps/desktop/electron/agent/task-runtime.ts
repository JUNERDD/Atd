import { Type } from 'typebox';
import type { AuthResult } from '@earendil-works/pi-ai';
import path from 'node:path';
import { RunDispatcher } from './run-dispatcher';
import { MemoryEntrySchema, type AgentEvent, type TaskDetail, type TaskState } from './bridge';
import { activeRun, isActive, type TaskRun } from './task-schema';
import type { PermissionAnswer, PermissionRecord, PermissionRequest } from './permission-schema';
import { AgentStore } from './store';
import { ContextResources } from './resources';
import { NativeTools } from './native-tools';
import { AgentWorker } from './worker-host';
import { TranscriptSnapshotSchema, type WorkerOutbound } from './worker-contract';
import type { CommandRequest } from './native-schema';
import { errorMessage } from './validation';
import { PermissionGate } from './permissions';
import { TaskAttributes } from './task-attributes';
import {
  declinedReply,
  assertQueueable,
  isLiveRun,
  statusForPending,
  TaskDocuments,
  TaskRequests,
  validatePermissionAnswer,
} from './task-requests';

interface RuntimeHost {
  publish: (event: AgentEvent) => void;
  changed: () => void;
  auth: (run: TaskRun) => Promise<AuthResult>;
  command: (request: CommandRequest) => Promise<unknown>;
  gate: PermissionGate;
}

export class TaskRuntime {
  readonly worker: AgentWorker;
  readonly native: NativeTools;
  readonly gate: PermissionGate;
  readonly attributes: TaskAttributes;
  private readonly documents = new TaskDocuments();
  private readonly requests = new TaskRequests();
  private readonly dispatcher: RunDispatcher;
  error = '';
  constructor(
    readonly root: string,
    readonly store: AgentStore,
    readonly resources: ContextResources,
    private host: RuntimeHost,
  ) {
    this.gate = host.gate;
    this.dispatcher = new RunDispatcher(this, host.auth);
    this.attributes = new TaskAttributes(
      store,
      (id) => this.task(id),
      (id) => this.publishTask(id),
    );
    this.native = new NativeTools(root, resources, {
      task: (id) => this.task(id),
      gate: this.gate,
      artifact: async (artifact) => {
        await store.change((data) => data.artifacts.push(artifact));
        this.publishTask(artifact.taskId);
      },
      command: (request) => this.host.command(request),
    });
    this.worker = new AgentWorker(root, {
      native: (request, onData) => {
        if (request.action !== 'modelAuth') return this.native.execute(request, onData);
        const run = this.task(request.taskId).runs.find((item) => item.id === request.runId);
        if (
          !run ||
          ['cancelled', 'failed', 'interrupted', 'stopping', 'stopped'].includes(run.status)
        )
          throw new Error('This model request is no longer active.');
        return this.host.auth(run);
      },
      event: (event) => this.event(event),
      failed: (message) => void this.fail(message),
    });
  }

  task(id: string) {
    const task = this.store.data.tasks.find((task) => task.id === id);
    if (!task) throw new Error('This task no longer exists.');
    return task;
  }

  state(id: string): TaskState {
    return {
      task: this.task(id),
      artifacts: this.store.data.artifacts.filter((file) => file.taskId === id),
      requests: this.requests.list(id),
      queue: this.documents.queue(id),
    };
  }

  cachedDetail(id: string): TaskDetail {
    return { ...this.state(id), ...this.documents.snapshot(id) };
  }

  async detail(id: string) {
    if (!this.documents.has(id)) {
      const snapshot = await this.loadTranscript(id);
      this.documents.replace(id, { revision: snapshot.revision, blocks: snapshot.blocks });
      this.gate.seed(id, snapshot.grants);
    }
    return this.cachedDetail(id);
  }

  publishTask(id: string) {
    if (this.store.data.tasks.some((task) => task.id === id))
      this.host.publish({ type: 'task', state: this.state(id) });
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
    switch (event.type) {
      case 'memoryChanged':
        this.host.publish({ type: 'memory', snapshot: await this.memory() });
        return;
      case 'notice':
        this.host.publish({ type: 'notice', notice: event });
        return;
      case 'question': {
        const answer = await this.ask(event.request);
        if (!('decision' in answer))
          await this.worker.call(
            { action: 'answer', requestId: event.request.id, answer },
            Type.Null(),
          );
        return;
      }
      case 'transcript':
        if (!this.store.data.tasks.some((task) => task.id === event.patch.taskId)) return;
        if (event.sessionFile) await this.rememberSession(event.patch.taskId, event.sessionFile);
        await this.publishTranscript(event.patch);
        return;
      case 'queue':
        if (!this.store.data.tasks.some((task) => task.id === event.taskId)) return;
        this.documents.setQueue(event.taskId, event.queue);
        this.publishTask(event.taskId);
        return;
      default: {
        const _exhaustive: never = event;
        throw new Error(`Unsupported worker event: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  private async publishTranscript(patch: Parameters<TaskDocuments['accept']>[0]) {
    const result = await this.documents.accept(patch, () => this.loadTranscript(patch.taskId));
    if ('error' in result) {
      this.host.publish({
        type: 'notice',
        notice: { taskId: patch.taskId, text: result.error, kind: 'error' },
      });
      return;
    }
    if (result.grants) this.gate.seed(patch.taskId, result.grants);
    this.host.publish({ type: 'transcript', patch: result.patch });
    this.host.changed();
  }

  private async loadTranscript(taskId: string) {
    await this.ready();
    return this.worker.call(
      { action: 'transcript', taskId, sessionFile: this.task(taskId).sessionFile },
      TranscriptSnapshotSchema,
    );
  }

  async recordPermission(taskId: string, record: PermissionRecord) {
    await this.worker.call({ action: 'record', taskId, record }, Type.Null());
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

  async ask(request: PermissionRequest): Promise<PermissionAnswer> {
    const declined = declinedReply(request);
    const run = this.task(request.taskId).runs.find((item) => item.id === request.runId);
    if (!run || !isLiveRun(run.status)) return declined;
    const pending = new Promise<PermissionAnswer>((resolve) => this.requests.add(request, resolve));
    try {
      await this.store.change((data) => {
        const active = data.tasks
          .find((task) => task.id === request.taskId)
          ?.runs.find((item) => item.id === request.runId);
        if (!active || !isLiveRun(active.status)) throw new Error('This request expired.');
        active.status = request.kind === 'input' ? 'awaiting_input' : 'awaiting_confirmation';
      });
      this.publishTask(request.taskId);
    } catch {
      this.requests.resolve(request.id, declined);
      this.requests.delete(request.id);
    }
    return pending;
  }

  async answer(taskId: string, runId: string, id: string, answer: PermissionAnswer) {
    const pending = this.requests.get(id);
    if (!pending || pending.request.taskId !== taskId || pending.request.runId !== runId)
      throw new Error('This request expired. Review the current task.');
    validatePermissionAnswer(pending.request, answer);
    await this.store.change((data) => {
      const task = data.tasks.find((task) => task.id === taskId);
      const run = task?.runs.find((run) => run.id === runId);
      if (!run || !isLiveRun(run.status) || !this.requests.get(id))
        throw new Error('This request expired. Review the current task.');
      run.status = statusForPending(this.requests.remaining(runId, id));
    });
    if (!this.requests.delete(id)) throw new Error('This request expired.');
    this.publishTask(taskId);
    pending.resolve(answer);
  }

  dismiss(runId: string) {
    this.requests.dismiss(runId);
  }

  resetQueue(taskId: string) {
    this.documents.resetQueue(taskId);
  }

  async rememberSession(taskId: string, sessionFile: string) {
    const task = this.task(taskId);
    if (task.sessionFile === sessionFile) return;
    const directory = path.join(this.root, 'agent', 'sessions', task.id) + path.sep;
    if (!sessionFile.startsWith(directory)) throw new Error('Invalid Agent session location.');
    await this.store.change((data) => {
      const current = data.tasks.find((item) => item.id === task.id);
      if (current) current.sessionFile = sessionFile;
    });
  }

  async queueMessage(taskId: string, text: string, mode: 'followUp' | 'steer') {
    this.requireActive(taskId);
    await this.ready();
    await this.worker.call({ action: 'queue', taskId, text, mode }, Type.Null());
  }

  async replaceQueue(taskId: string, followUp: string[]) {
    this.requireActive(taskId);
    await this.ready();
    await this.worker.call({ action: 'replaceQueue', taskId, followUp }, Type.Null());
  }

  async stop(taskId: string, runId: string) {
    const run = this.task(taskId).runs.find((item) => item.id === runId);
    if (!run || !isActive(run.status)) return;
    if (run.status === 'queued') {
      await this.status(taskId, runId, 'cancelled');
      return;
    }
    await this.status(taskId, runId, 'stopping');
    this.dismiss(runId);
    this.native.stop(runId);
    await this.worker.call({ action: 'stop', runId }, Type.Null());
  }

  dispatch() {
    this.dispatcher.dispatch();
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
    const known = this.documents.known(taskId);
    this.documents.forget(taskId);
    this.requests.forget(taskId);
    this.gate.forget(taskId);
    if (known) await this.worker.call({ action: 'forget', taskId }, Type.Null());
  }

  private requireActive(taskId: string) {
    assertQueueable(activeRun(this.task(taskId))?.status);
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
            this.resetQueue(task.id);
            this.native.stop(run.id);
          }
    });
    this.host.changed();
  }

  async close() {
    this.dispatcher.closing = true;
    for (const task of this.store.data.tasks)
      for (const run of task.runs)
        if (isActive(run.status)) {
          this.dismiss(run.id);
          this.native.stop(run.id);
        }
    await this.worker.close();
  }
}
