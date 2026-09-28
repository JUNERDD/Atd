import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type WebContents } from 'electron';
import path from 'node:path';
import type { SettingsService } from '../settings-service';
import type { ServiceConnection } from '../service/connection';
import { sendToPage } from '../window-content';
import { AgentRequests, type AgentPlatform } from './agent-requests';
import { handleArtifact } from './artifacts';
import { attachFiles } from './attachable-files';
import { ATTACHABLE_EXTENSIONS } from './attachable-rules';
import { AgentRequestSchema, type AgentEvent, type PreparedCommand } from './bridge';
import { AGENT_IPC } from './ipc-channels';
import { AgentStore } from './store';
import { CommandService } from './command-service';
import { parse } from './validation';
import { activeRun, type RunStatus } from './task-schema';

/**
 * Events only the panel renders (task detail, transcripts, notices). The settings window reads the
 * snapshot and memory, and a subagent transcript goes to the window that holds it.
 */
const PANEL_EVENTS: ReadonlySet<AgentEvent['type']> = new Set(['task', 'transcript', 'notice']);

/**
 * The desktop's agent bridge: IPC in front of the shared `AgentRequests`, plus the Electron
 * abilities the web client replaces with browser APIs (native file picker, clipboard, shell).
 * Main owns no agent execution; tasks, confirms and transcripts come from the agent service.
 */
export class AgentService {
  readonly commands: CommandService;
  private readonly requests: AgentRequests<WebContents>;
  /** Windows whose task and subagent-transcript holds are dropped when they close or reload. */
  private readonly watched = new Set<WebContents>();
  private readonly taskListeners = new Set<() => void>();

  private constructor(
    store: AgentStore,
    private readonly settings: SettingsService,
    private readonly connection: ServiceConnection,
    emitLaunch: (prepared: PreparedCommand, autoRun: boolean) => void,
    choose: <T>(operation: () => Promise<T>) => Promise<T>,
  ) {
    this.commands = new CommandService(
      store,
      () => settings.snapshot().shortcuts,
      emitLaunch,
      () => this.requests.broadcast(),
      () => this.connection.options(),
    );
    this.commands.initialize();
    const platform: AgentPlatform = {
      chooseFiles: (http) =>
        choose(async () => {
          const picked = await dialog.showOpenDialog({
            title: 'Attach text files',
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: 'Text files', extensions: [...ATTACHABLE_EXTENSIONS] }],
          });
          return picked.canceled ? [] : attachFiles(http, picked.filePaths);
        }),
      copy: async (text) => clipboard.writeText(text),
      openLink: (url) => shell.openExternal(url),
      artifact: (options, artifactId, operation) =>
        handleArtifact(
          options,
          path.join(app.getPath('userData'), 'agent-v1', 'downloads'),
          artifactId,
          operation,
        ),
      launch: emitLaunch,
    };
    this.requests = new AgentRequests(
      {
        http: () => connection.http(),
        options: () => connection.options(),
        setTaskHandlers: (handlers) => connection.setTaskHandlers(handlers),
        unavailable: () =>
          connection.status().state === 'disconnected' ? connection.status().detail : '',
      },
      this.commands,
      platform,
      {
        emit: (event) => {
          if (PANEL_EVENTS.has(event.type)) settings.sendToPanel(AGENT_IPC.changed, event);
          else settings.send(AGENT_IPC.changed, event);
          if (event.type === 'snapshot') for (const listener of this.taskListeners) listener();
        },
        defaultConnectionId: () => settings.snapshot().defaultConnectionId,
        defaultModel: () => {
          const snapshot = settings.snapshot();
          const id = snapshot.defaultConnectionId;
          const connection = snapshot.connections.find((item) => item.connectionId === id);
          return id && connection?.defaultModel
            ? { connectionId: id, modelId: connection.defaultModel }
            : undefined;
        },
      },
      (sender, event: AgentEvent) => {
        if (!sender.isDestroyed())
          sendToPage(BrowserWindow.fromWebContents(sender), AGENT_IPC.changed, event);
      },
    );
    connection.onInvalidate((frame) => void this.requests.onInvalidate(frame));
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

  /**
   * Runs `listener` after each published task list, which follows every run status, request or
   * queue change of a cached task; read the result through `taskStates`.
   */
  onTasksChanged(listener: () => void): () => void {
    this.taskListeners.add(listener);
    return () => {
      this.taskListeners.delete(listener);
    };
  }

  /** Every cached task's latest run status and pending request count. */
  taskStates(): { status: RunStatus | undefined; pendingRequests: number }[] {
    return [...this.requests.tasks.entries.values()].map((entry) => ({
      status: activeRun(entry.task)?.status,
      pendingRequests: entry.requests.length,
    }));
  }

  /** Pulls live commands after the service connection becomes ready. */
  async syncLive(): Promise<void> {
    try {
      await this.commands.refreshFromService();
    } catch {
      // A failed refresh leaves the last cache; the next get() surfaces the error.
    }
  }

  installIpc() {
    ipcMain.handle(AGENT_IPC.request, (event, value: unknown) => {
      this.settings.assertSender(event);
      const request = parse(AgentRequestSchema, value);
      this.watch(event.sender);
      return this.requests.handle(request, event.sender);
    });
  }

  /** Clears cached tasks; connection disconnect is owned by ServiceManager. */
  async close(): Promise<void> {
    this.requests.tasks.clear();
  }

  /**
   * A destroyed window cannot release its task or subagent transcripts, and a reloaded page starts
   * without holds, so both drop every hold of that webContents.
   */
  private watch(sender: WebContents) {
    if (this.watched.has(sender)) return;
    this.watched.add(sender);
    const drop = () => {
      this.requests.tasks.children.dropSubscriber(sender);
      this.requests.tasks.release(sender);
    };
    sender.on('did-navigate', drop);
    sender.once('destroyed', () => {
      this.watched.delete(sender);
      drop();
    });
  }
}
