import type { AgentClientOptions, AgentHttpClient } from '@ai/agent-client';
import type { InvalidateFrame } from '@ai/agent-contracts';
import type {
  AgentEvent,
  AgentRequest,
  AgentSnapshot,
  MemorySnapshot,
  PreparedCommand,
} from './bridge';
import type { CommandDefinition } from './command-schema';
import {
  compactLiveTask,
  deleteLiveTask,
  loadMemory,
  notConnected,
  previewRun,
  renameLiveTask,
  replaceLiveQueue,
  retierLiveTask,
  saveMemoryEntry,
  setMemoryPaused,
} from './service-manage';
import { TaskClient, type TaskConnection } from './service-tasks';
import type { FileRef } from './task-schema';

/** The command list as each client keeps it: the desktop also binds global shortcuts. */
export interface CommandCatalog {
  readonly errors: Record<string, string>;
  list(): CommandDefinition[];
  find(id: string): CommandDefinition;
  prepare(id: string): Promise<PreparedCommand>;
  capture(source: 'selection' | 'clipboard'): Promise<{ text: string; capturedAt: string }>;
  save(command: CommandDefinition, expectedRevision: number): Promise<CommandDefinition>;
  delete(id: string, revision: number): Promise<void>;
  /** Reloads the list from the service (connect, or another client changed it). */
  refreshFromService(): Promise<void>;
}

/** What only the host can do: native pickers and clipboard in Electron, browser APIs on the web. */
export interface AgentPlatform {
  /** Lets the user pick files and uploads them; resolves `[]` when cancelled. */
  chooseFiles(http: AgentHttpClient): Promise<FileRef[]>;
  copy(text: string): Promise<void>;
  /** `url` is already checked to be http(s). */
  openLink(url: string): Promise<void>;
  artifact(
    options: AgentClientOptions,
    artifactId: string,
    operation: 'open' | 'reveal' | 'copy' | 'locate' | 'attach',
  ): Promise<FileRef | null>;
  launch(prepared: PreparedCommand, autoRun: boolean): void;
}

export interface AgentConnection extends TaskConnection {
  /** The reason the service is unreachable; empty while connected or connecting. */
  unavailable(): string;
}

export interface AgentHost {
  emit(event: AgentEvent): void;
  defaultConnectionId(): string | null;
  defaultModel(): { connectionId: string; modelId: string } | undefined;
}

/**
 * The agent bridge's request handling, shared by the desktop main process (behind IPC) and the
 * web client (called directly). Everything here is a service call or cached service state;
 * host-only abilities go through `AgentPlatform`. `S` identifies a subagent-transcript holder.
 */
export class AgentRequests<S> {
  readonly tasks: TaskClient<S>;
  private revision = 0;
  private mutation: Promise<void> = Promise.resolve();
  private memory: MemorySnapshot = { entries: [], paused: false, error: '' };

  constructor(
    private readonly connection: AgentConnection,
    private readonly commands: CommandCatalog,
    private readonly platform: AgentPlatform,
    private readonly host: AgentHost,
    forward: (subscriber: S, event: AgentEvent) => void,
  ) {
    this.tasks = new TaskClient(
      connection,
      { find: (id) => commands.find(id) },
      {
        emit: (event) => host.emit(event),
        broadcast: () => this.broadcast(),
        defaultModel: () => host.defaultModel(),
      },
      forward,
    );
  }

  snapshot(): AgentSnapshot {
    return {
      revision: ++this.revision,
      connectionId: this.host.defaultConnectionId() ?? '',
      commands: this.commands.list(),
      tasks: this.tasks.tasks(),
      shortcutErrors: { ...this.commands.errors },
      error: this.connection.unavailable(),
    };
  }

  broadcast() {
    this.host.emit({ type: 'snapshot', snapshot: this.snapshot() });
  }

  /** Reloads what another client changed; task-scoped frames go to the task cache. */
  async onInvalidate(frame: InvalidateFrame): Promise<void> {
    switch (frame.scope) {
      case 'commands':
        await this.commands.refreshFromService().catch(() => undefined);
        return;
      case 'memory':
        await this.handle({ action: 'memory' }).catch(() => undefined);
        return;
      case 'task':
      case 'task.deleted':
        await this.tasks.onInvalidate(frame);
        return;
      default:
        return;
    }
  }

  private options() {
    const options = this.connection.options();
    if (!options) throw notConnected();
    return options;
  }

  private publishMemory(snapshot: MemorySnapshot) {
    this.memory = snapshot;
    this.host.emit({ type: 'memory', snapshot });
  }

  /** Command writes run one at a time so revisions never race each other. */
  handle(request: AgentRequest, subscriber?: S): Promise<unknown> {
    if (request.action !== 'saveCommand' && request.action !== 'deleteCommand')
      return this.dispatch(request, subscriber);
    const pending = this.mutation.then(() => this.dispatch(request, subscriber));
    this.mutation = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  private async dispatch(request: AgentRequest, subscriber?: S): Promise<unknown> {
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
          this.platform.launch({ command, input: request.prepared.input, notice: '' }, false);
        } else this.platform.launch(await this.commands.prepare(request.commandId), false);
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
        const { unsent } = await this.tasks.http().cancel(request.taskId, request.runId);
        return unsent;
      }
      case 'answer':
        return this.answer(request);
      // Queue edits publish through the service's `queue.update` event, like Pi's own deliveries.
      case 'queueMessage':
        await this.tasks.http().queue(request.taskId, { text: request.text, mode: request.mode });
        return null;
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
        this.tasks.children.forgetTask(request.taskId);
        this.broadcast();
        return null;
      case 'compactTask':
        await compactLiveTask(this.options(), request.taskId, request.instructions);
        return null;
      case 'chooseFiles':
        return this.platform.chooseFiles(this.tasks.http());
      case 'memory':
        // A failed load (or no connection) is reported inside the snapshot, never thrown.
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
        return this.platform.artifact(this.options(), request.artifactId, request.operation);
      case 'copy':
        await this.platform.copy(request.text);
        return null;
      case 'openLink': {
        const url = new URL(request.url);
        if (!['http:', 'https:'].includes(url.protocol))
          throw new Error('Only web links can be opened.');
        await this.platform.openLink(url.href);
        return null;
      }
      case 'importLegacy':
        return null;
      case 'childTranscript':
        if (subscriber === undefined) throw new Error('A subagent transcript needs a subscriber.');
        return this.tasks.children.subscribe(subscriber, request.taskId, request.childKey);
      case 'releaseChildTranscript':
        if (subscriber !== undefined)
          this.tasks.children.release(subscriber, request.taskId, request.childKey);
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
      await this.tasks.http().confirm({
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
