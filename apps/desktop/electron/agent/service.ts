import { app, clipboard, ipcMain, shell } from 'electron';
import path from 'node:path';
import type { SettingsService } from '../settings-service';
import type { ServiceConnection } from '../service/connection';
import {
  AgentRequestSchema,
  type AgentRequest,
  type AgentSnapshot,
  type MemorySnapshot,
  type PreparedCommand,
} from './bridge';
import { AGENT_IPC } from './ipc-channels';
import { AgentStore } from './store';
import { CommandService } from './command-service';
import {
  deleteLiveTask,
  handleArtifact,
  loadMemory,
  notConnected,
  previewRun,
  renameLiveTask,
  replaceLiveQueue,
  retierLiveTask,
  saveMemoryEntry,
  setMemoryPaused,
} from './service-manage';
import { parse } from './validation';
import { TaskClient } from './service-tasks';

/**
 * Pure service client. Main owns NO agent execution: no worker, Pi, Hermes,
 * native tools or local runs. Tasks/confirms/transcript come from the agent
 * service; commands/shortcuts/selection/clipboard/file-picker stay as
 * explicit desktop APIs. Management calls use live v1.2 APIs.
 */
export class AgentService {
  readonly commands: CommandService;
  private readonly tasks: TaskClient;
  private revision = 0;
  private mutation: Promise<void> = Promise.resolve();
  private memory: MemorySnapshot = { entries: [], paused: false, error: '' };

  private constructor(
    private readonly store: AgentStore,
    private readonly settings: SettingsService,
    private readonly connection: ServiceConnection,
    private readonly emitLaunch: (prepared: PreparedCommand, autoRun: boolean) => void,
    private readonly choose: <T>(operation: () => Promise<T>) => Promise<T>,
  ) {
    this.commands = new CommandService(
      store,
      () => settings.snapshot().shortcuts,
      emitLaunch,
      () => this.broadcast(),
      () => this.connection.options(),
    );
    this.commands.initialize();
    this.tasks = new TaskClient(connection, this.commands, {
      send: (channel, value) => settings.send(channel, value),
      broadcast: () => this.broadcast(),
      defaultModel: () => {
        const snapshot = settings.snapshot();
        const id = snapshot.defaultConnectionId;
        const connection = snapshot.connections.find((item) => item.connectionId === id);
        return id && connection?.defaultModel
          ? { connectionId: id, modelId: connection.defaultModel }
          : undefined;
      },
    });
  }

  static async create(
    settings: SettingsService,
    launch: (prepared: PreparedCommand, autoRun: boolean) => void,
    choose: <T>(operation: () => Promise<T>) => Promise<T>,
    connection: ServiceConnection,
  ) {
    const store = await AgentStore.load(path.join(app.getPath('userData'), 'agent-v1'));
    return new AgentService(store, settings, connection, launch, choose);
  }

  /** Pulls live commands after the service connection becomes ready. */
  async syncLive(): Promise<void> {
    try {
      await this.commands.refreshFromService();
    } catch {
      // A failed refresh leaves the last cache; the next get() surfaces the error.
    }
  }

  private snapshot(): AgentSnapshot {
    return {
      revision: ++this.revision,
      connectionId: this.settings.snapshot().defaultConnectionId ?? '',
      commands: this.store.data.commands,
      tasks: this.tasks.tasks(),
      shortcutErrors: { ...this.commands.errors },
      error:
        this.connection.status().state === 'disconnected' ? this.connection.status().detail : '',
    };
  }

  private broadcast() {
    this.settings.send(AGENT_IPC.changed, { type: 'snapshot', snapshot: this.snapshot() });
  }

  private publishMemory(snapshot: MemorySnapshot) {
    this.memory = snapshot;
    this.settings.send(AGENT_IPC.changed, { type: 'memory', snapshot });
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
      if (['saveCommand', 'deleteCommand'].includes(request.action))
        return this.serialize(() => this.handle(request));
      return this.handle(request);
    });
  }

  /** Clears cached tasks; connection disconnect is owned by ServiceManager. */
  async close(): Promise<void> {
    this.tasks.clear();
  }

  private options() {
    const options = this.connection.options();
    if (!options) throw notConnected();
    return options;
  }

  private async handle(request: AgentRequest): Promise<unknown> {
    switch (request.action) {
      case 'get':
        return this.snapshot();
      case 'detail':
        return this.tasks.detail(request.taskId);
      case 'launch': {
        if (request.prepared) {
          const command = this.commands.find(request.commandId);
          if (!command.enabled || command.revision !== request.prepared.revision)
            throw new Error('This command changed or is disabled. Review before running.');
          this.emitLaunch({ command, input: request.prepared.input, notice: '' }, false);
        } else this.emitLaunch(await this.commands.prepare(request.commandId), false);
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
        return previewRun(
          this.options(),
          request.input,
          request.command?.id ?? null,
          request.policy,
        );
      case 'submit':
        return this.tasks.submit(request);
      case 'stop': {
        const http = this.connection.http();
        if (!http) throw notConnected();
        const { unsent } = await http.cancel(request.taskId, request.runId);
        return unsent;
      }
      case 'answer':
        return this.answer(request);
      // Queue edits publish through the service's `queue.update` event, like Pi's own deliveries.
      case 'queueMessage': {
        const http = this.connection.http();
        if (!http) throw notConnected();
        await http.queue(request.taskId, { text: request.text, mode: request.mode });
        return null;
      }
      case 'replaceQueue':
        await replaceLiveQueue(this.options(), request.taskId, request.followUp);
        return null;
      case 'setPermissionTier':
        await retierLiveTask(this.options(), request.taskId, request.tier);
        await this.tasks.detail(request.taskId);
        this.tasks.publishTask(request.taskId);
        return null;
      case 'renameTask':
        await renameLiveTask(this.options(), request.taskId, request.title);
        await this.tasks.detail(request.taskId);
        this.tasks.publishTask(request.taskId);
        return null;
      case 'deleteTask':
        await deleteLiveTask(this.options(), request.taskId);
        this.tasks.details.delete(request.taskId);
        this.broadcast();
        return null;
      case 'chooseFiles':
        return this.choose(() => this.tasks.chooseFiles());
      case 'memory':
        try {
          this.publishMemory(await loadMemory(this.options()));
        } catch (error) {
          this.publishMemory({
            entries: [],
            paused: false,
            error: error instanceof Error ? error.message : 'Memory could not be loaded.',
          });
        }
        return this.memory;
      case 'pauseMemory':
        this.publishMemory(await setMemoryPaused(this.options(), request.paused));
        return this.memory;
      case 'updateMemory':
        this.publishMemory(await saveMemoryEntry(this.options(), request.entry, request.content));
        return this.memory;
      case 'artifact':
        return handleArtifact(
          this.options(),
          path.join(app.getPath('userData'), 'agent-v1', 'downloads'),
          request.artifactId,
          request.operation,
        );
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
      case 'importLegacy':
        return null;
      default: {
        const _exhaustive: never = request;
        throw new Error(`Unsupported agent action: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  private async answer(request: Extract<AgentRequest, { action: 'answer' }>): Promise<null> {
    const live = this.tasks.revisions.get(request.requestId);
    if (!live || live.taskId !== request.taskId || live.runId !== request.runId)
      throw new Error('This request expired. Review the current task.');
    try {
      await this.connection.http()!.confirm({
        requestId: request.requestId,
        revision: live.revision,
        answer: request.answer,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('410') || message.toLowerCase().includes('no longer pending'))
        throw new Error('This request expired. Review the current task.');
      if (message.includes('409') || message.toLowerCase().includes('changed'))
        throw new Error('The request changed. Refresh and answer the latest version.');
      throw error;
    }
    return null;
  }
}
