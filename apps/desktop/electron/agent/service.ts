import { app, clipboard, ipcMain, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { Type } from 'typebox';
import type { SettingsService } from '../settings-service';
import { FileRefSchema, isActive } from './task-schema';
import {
  AGENT_IPC,
  AgentRequestSchema,
  type AgentRequest,
  type AgentSnapshot,
  type PreparedCommand,
} from './bridge';
import { AgentStore } from './store';
import { canonicalPath, ContextResources } from './resources';
import { CommandService } from './command-service';
import { CommandTool } from './command-tool';
import { TaskRuntime } from './task-runtime';
import { RunService } from './run-service';
import { ArtifactService } from './artifact-service';
import { parse } from './validation';

const LegacySchema = Type.Object({
  version: Type.Literal(1),
  tasks: Type.Array(
    Type.Object({
      id: Type.String(),
      prompt: Type.String({ maxLength: 4000 }),
      attachments: Type.Array(FileRefSchema),
      createdAt: Type.String(),
    }),
  ),
  pinned: Type.Optional(Type.Boolean()),
});

export class AgentService {
  readonly commands: CommandService;
  readonly runtime: TaskRuntime;
  private readonly runs: RunService;
  private readonly artifacts: ArtifactService;
  private revision = 0;
  private mutation: Promise<void> = Promise.resolve();
  private constructor(
    private store: AgentStore,
    resources: ContextResources,
    root: string,
    private settings: SettingsService,
    private launch: (prepared: PreparedCommand, autoRun: boolean) => void,
    private choose: <T>(operation: () => Promise<T>) => Promise<T>,
  ) {
    this.commands = new CommandService(
      store,
      () => settings.snapshot().shortcuts,
      launch,
      () => this.broadcast(),
    );
    this.commands.initialize();
    const commandTool = new CommandTool(store, this.commands, (request) =>
      this.runtime.ask(request),
    );
    this.runtime = new TaskRuntime(root, store, resources, {
      publish: (event) => settings.send(AGENT_IPC.changed, event),
      changed: () => this.broadcast(),
      auth: (run) => settings.providers.runtime.auth(run.snapshot.model),
      command: (request) => commandTool.execute(request),
    });
    this.runs = new RunService(
      this.runtime,
      (command, reference) =>
        settings.providers.runtime.resolve(
          reference ?? (command?.model.mode === 'fixed' ? command.model : null),
        ),
      (model) => {
        settings.providers.runtime.assertModel(model);
      },
    );
    this.artifacts = new ArtifactService(this.runtime);
  }

  static async create(
    settings: SettingsService,
    launch: (prepared: PreparedCommand, autoRun: boolean) => void,
    choose: <T>(operation: () => Promise<T>) => Promise<T>,
  ) {
    const root = path.join(await canonicalPath(app.getPath('userData')), 'agent-v1');
    const store = await AgentStore.load(root);
    const resources = new ContextResources(root);
    await resources.load();
    if (store.data.tasks.some((task) => task.runs.some((run) => isActive(run.status)))) {
      await store.change((data) => {
        for (const task of data.tasks)
          for (const run of task.runs)
            if (isActive(run.status)) {
              run.status = 'interrupted';
              run.error =
                'The app closed before this run finished. Review its input and completed actions before continuing.';
            }
      });
    }
    return new AgentService(store, resources, root, settings, launch, choose);
  }

  private connectionId() {
    return this.settings.snapshot().defaultConnectionId ?? '';
  }

  private snapshot(): AgentSnapshot {
    return {
      revision: ++this.revision,
      connectionId: this.connectionId(),
      commands: this.store.data.commands,
      tasks: [...this.store.data.tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      shortcutErrors: { ...this.commands.errors },
      error: this.runtime.error,
    };
  }

  private broadcast() {
    this.settings.send(AGENT_IPC.changed, { type: 'snapshot', snapshot: this.snapshot() });
  }

  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const pending = this.mutation.then(action);
    this.mutation = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  installIpc() {
    ipcMain.handle(AGENT_IPC.request, (event, value: unknown) => {
      this.settings.assertSender(event);
      const request = parse(AgentRequestSchema, value);
      if (
        [
          'saveCommand',
          'deleteCommand',
          'pauseMemory',
          'updateMemory',
          'deleteTask',
          'importLegacy',
        ].includes(request.action)
      )
        return this.serialize(() => this.handle(request));
      return this.handle(request);
    });
  }

  private async handle(request: AgentRequest): Promise<unknown> {
    switch (request.action) {
      case 'get':
        return this.snapshot();
      case 'detail':
        await this.artifacts.refresh(request.taskId);
        return this.runtime.detail(request.taskId);
      case 'launch': {
        if (request.prepared) {
          const command = this.commands.find(request.commandId);
          if (!command.enabled || command.revision !== request.prepared.revision)
            throw new Error('This command changed or is disabled. Review before running.');
          await this.runs.preview(request.prepared.input, command);
          this.launch({ command, input: request.prepared.input, notice: '' }, false);
        } else this.launch(await this.commands.prepare(request.commandId), false);
        return null;
      }
      case 'prepare':
        return this.commands.prepare(request.commandId);
      case 'capture':
        return this.commands.capture(request.source);
      case 'saveCommand':
        return this.commands.save(request.command, request.expectedRevision);
      case 'deleteCommand':
        await this.commands.delete(request.commandId, request.revision);
        return null;
      case 'preview':
        return this.runs.preview(request.input, request.command, request.policy);
      case 'submit':
        return this.runs.submit(request);
      case 'stop':
        return this.runtime.stop(request.taskId, request.runId);
      case 'answer':
        return this.runtime.answer(
          request.taskId,
          request.runId,
          request.requestId,
          request.answer,
        );
      case 'chooseFiles':
        return this.choose(() => this.runtime.resources.choose());
      case 'artifact':
        return this.choose(() => this.artifacts.act(request));
      case 'copy':
        await clipboard.writeText(request.text);
        return null;
      case 'openLink': {
        const url = new URL(request.url);
        if (!['http:', 'https:'].includes(url.protocol))
          throw new Error('Only web links can be opened.');
        await shell.openExternal(url.href);
        return null;
      }
      case 'memory':
        return this.runtime.memory();
      case 'pauseMemory': {
        await this.runtime.ready();
        // Freeze pending learners before committing policy; restore on persistence failure with a new epoch.
        await this.runtime.worker.call({ action: 'pause', paused: request.paused }, Type.Null());
        try {
          await this.store.change((data) => {
            data.memoryPaused = request.paused;
          });
        } catch (error) {
          await this.runtime.worker.call(
            { action: 'pause', paused: this.store.data.memoryPaused },
            Type.Null(),
          );
          throw error;
        }
        const snapshot = await this.runtime.memory();
        this.settings.send(AGENT_IPC.changed, { type: 'memory', snapshot });
        return snapshot;
      }
      case 'updateMemory': {
        await this.runtime.ready();
        await this.runtime.worker.call(
          { action: 'memoryUpdate', entry: request.entry, content: request.content },
          Type.String(),
        );
        const snapshot = await this.runtime.memory();
        this.settings.send(AGENT_IPC.changed, { type: 'memory', snapshot });
        return snapshot;
      }
      case 'deleteTask': {
        const task = this.runtime.task(request.taskId);
        if (task.runs.some((run) => isActive(run.status)))
          throw new Error('Stop this task before deleting it.');
        await this.runtime.forget(task.id);
        await this.store.change((data) => {
          data.tasks = data.tasks.filter((item) => item.id !== task.id);
          data.artifacts = data.artifacts.filter((file) => file.taskId !== task.id);
        });
        await this.runtime.resources.deleteTask(task.id);
        await rm(path.join(this.runtime.root, 'agent', 'sessions', task.id), {
          recursive: true,
          force: true,
        });
        await rm(path.join(this.runtime.root, 'tasks', task.id), { recursive: true, force: true });
        this.broadcast();
        return null;
      }
      case 'importLegacy': {
        if (this.store.data.legacyImported) return null;
        const legacy = parse(LegacySchema, JSON.parse(request.json));
        await this.store.change((data) => {
          if (data.legacyImported) return;
          for (const item of legacy.tasks) {
            data.tasks.push({
              id: randomUUID(),
              title: item.prompt.slice(0, 120) || item.attachments[0]?.name || 'Imported task',
              createdAt: item.createdAt,
              updatedAt: item.createdAt,
              sessionFile: null,
              runs: [],
              legacy: { prompt: item.prompt, attachments: item.attachments },
            });
          }
          data.legacyImported = true;
        });
        this.broadcast();
        return null;
      }
    }
  }
}
