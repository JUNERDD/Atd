import {
  taskContextBreakdown,
  type AgentClientOptions,
  type AgentHttpClient,
} from '@atd/agent-client';
import type { InvalidateFrame } from '@atd/agent-contracts';
import type { AgentEvent, AgentRequest, AgentSnapshot, PreparedCommand } from './bridge';
import type { CommandDefinition } from './command-schema';
import { isMemoryRequest, runMemoryRequest } from './memory-manage';
import type { Screenshot } from './screenshot-input';
import {
  compactLiveTask,
  deleteLiveTask,
  forkLiveTask,
  notConnected,
  previewRun,
  renameLiveTask,
  replaceLiveQueue,
  retierLiveTask,
} from './service-manage';
import { TaskClient, type TaskConnection } from './service-tasks';
import { submitTask } from './task-submit';
import type { FileRef } from './task-schema';
import type { SaveContent } from '../../native-bridge/calls';

/** The command list as each client keeps it: the desktop also binds global shortcuts. */
export interface CommandCatalog {
  readonly errors: Record<string, string>;
  list(): CommandDefinition[];
  find(id: string): CommandDefinition;
  prepare(id: string): Promise<PreparedCommand>;
  /**
   * Prepares a command as its shortcut does, except that `text` (taken from the page) stands in for
   * the selection, so the shell reads none; the clipboard and a screenshot are captured as usual.
   * Rejects with an English message when `text` is over the capture limit.
   */
  prepareWithText(id: string, text: string): Promise<PreparedCommand>;
  capture(source: 'selection' | 'clipboard'): Promise<{ text: string; capturedAt: string }>;
  /**
   * Lets the user capture the screen and imports the image; null when the user cancelled. Rejects
   * with an English message when the capture is not permitted or the import fails.
   */
  screenshot(): Promise<Screenshot | null>;
  save(command: CommandDefinition, expectedRevision: number): Promise<CommandDefinition>;
  delete(id: string, revision: number): Promise<void>;
  /** Reloads the list from the service (connect, or another client changed it). */
  refreshFromService(): Promise<void>;
}

/** What only the host can do: native pickers, clipboard, links and artifact operations. */
export interface AgentPlatform {
  /** Lets the user pick files and uploads them; resolves `[]` when cancelled. */
  chooseFiles(http: AgentHttpClient): Promise<FileRef[]>;
  copy(text: string): Promise<void>;
  /** `url` is already checked to be http(s). */
  openLink(url: string): Promise<void>;
  /** Offers `content` under the suggested `name` in a save panel; false when cancelled. */
  saveFile(name: string, content: SaveContent): Promise<boolean>;
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
}

/**
 * The agent bridge's request handling, which the macOS shell's page (`native-host`) calls
 * directly. Everything here is a service call or cached service state; host-only abilities go
 * through `AgentPlatform`. `S` identifies a subagent-transcript holder.
 */
export class AgentRequests<S> {
  readonly tasks: TaskClient<S>;
  private revision = 0;
  /** The pending publish of task changes; see `scheduleBroadcast`. */
  private scheduled: ReturnType<typeof setTimeout> | null = null;
  private mutation: Promise<void> = Promise.resolve();

  constructor(
    private readonly connection: AgentConnection,
    private readonly commands: CommandCatalog,
    private readonly platform: AgentPlatform,
    private readonly host: AgentHost,
    forward: (subscriber: S, event: AgentEvent) => void,
  ) {
    this.tasks = new TaskClient(
      connection,
      {
        emit: (event) => host.emit(event),
        broadcast: () => this.scheduleBroadcast(),
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

  /** Publishes the snapshot now, which also covers a scheduled publish. */
  broadcast() {
    if (this.scheduled !== null) clearTimeout(this.scheduled);
    this.scheduled = null;
    this.host.emit({ type: 'snapshot', snapshot: this.snapshot() });
  }

  /**
   * Publishes task changes once per burst. Connecting replays one stream snapshot per task, and
   * publishing the whole task list after each would send it once per task. The snapshot is built
   * when the timer fires, so it carries the final state; `handle` publishes a pending one before a
   * request settles, so a reply never arrives ahead of the list it changed.
   */
  private scheduleBroadcast() {
    this.scheduled ??= setTimeout(() => this.broadcast(), 0);
  }

  private flushBroadcast() {
    if (this.scheduled !== null) this.broadcast();
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
      // The native host reloads these itself (extensions, settings, providers and apps); no page
      // shows widgets.
      case 'apps':
      case 'widgets':
      case 'extensions':
      case 'providers':
      case 'settings':
        return;
    }
  }

  private options() {
    const options = this.connection.options();
    if (!options) throw notConnected();
    return options;
  }

  /** Command writes run one at a time so revisions never race each other. */
  handle(request: AgentRequest, subscriber?: S): Promise<unknown> {
    const run = () => this.dispatch(request, subscriber).finally(() => this.flushBroadcast());
    if (request.action !== 'saveCommand' && request.action !== 'deleteCommand') return run();
    const pending = this.mutation.then(run);
    this.mutation = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  private async dispatch(request: AgentRequest, subscriber?: S): Promise<unknown> {
    if (isMemoryRequest(request)) {
      // A failed read (or no connection) is reported inside the snapshot, never thrown; every
      // window sees the snapshot a write produced before its answer settles.
      const { snapshot, answer } = await runMemoryRequest(this.connection.options(), request);
      this.host.emit({ type: 'memory', snapshot });
      return answer;
    }
    switch (request.action) {
      case 'get':
        return this.snapshot();
      case 'detail':
        return this.tasks.detail(request.taskId, subscriber);
      case 'launch': {
        if (request.prepared) {
          const command = this.commands.find(request.commandId);
          if (!command.enabled || command.revision !== request.prepared.revision)
            throw new Error('This command changed or is disabled. Review before running.');
          this.platform.launch({ command, input: request.prepared.input, notice: '' }, false);
        } else this.platform.launch(await this.commands.prepare(request.commandId), false);
        return null;
      }
      case 'prepareWithText':
        return this.commands.prepareWithText(request.commandId, request.text);
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
        return submitTask(
          this.tasks,
          { options: () => this.connection.options(), findCommand: (id) => this.commands.find(id) },
          request,
          subscriber,
        );
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
        await this.tasks.loadSummary(request.taskId);
        return null;
      case 'renameTask':
        await renameLiveTask(this.options(), request.taskId, request.title);
        await this.tasks.loadSummary(request.taskId);
        return null;
      case 'deleteTask':
        await deleteLiveTask(this.options(), request.taskId);
        this.tasks.forget(request.taskId);
        this.broadcast();
        return null;
      case 'compactTask':
        return compactLiveTask(this.options(), request.taskId, request.instructions);
      case 'contextBreakdown':
        return (await taskContextBreakdown(this.options(), request.taskId)).breakdown;
      case 'forkTask': {
        const { taskId, entryId, title } = request;
        const fork = await forkLiveTask(this.options(), taskId, {
          entryId,
          ...(title === undefined ? {} : { title }),
        });
        await this.tasks.loadSummary(fork.taskId);
        return fork;
      }
      case 'chooseFiles':
        return this.platform.chooseFiles(this.tasks.http());
      case 'saveFile':
        return this.platform.saveFile(request.name, request.content);
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
