import { join } from 'node:path';
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  nativeTheme,
  screen,
  session,
} from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import log from 'electron-log/main';
import { Type } from 'typebox';
import { AgentService } from './agent/service';
import {
  ExtensionSessionKindSchema,
  type CommandSession,
  type ExtensionSession,
} from './agent/bridge';
import { AGENT_IPC } from './agent/ipc-channels';
import { Identifier } from './agent/command-schema';
import { parse } from './agent/validation';
import { IPC, type DesktopState } from './contract';
import { chooseContextFiles } from './context-files';
import { appItems, installAppMenu } from './app-menu';
import { DockVisibility } from './dock-visibility';
import { MenuBarItem } from './menu-bar';
import { installFileSearch } from './file-search/ipc';
import { ServiceManager } from './service/manager';
import { SETTINGS_IPC } from './settings-contract';
import { SettingsService } from './settings-service';
import { isWindowSender, loadWindowContent } from './window-content';
import { PanelPlacement } from './panel-placement';
import { createPanelWindow } from './panel-window';
import { openedAtLogin } from './login-item';
import { installQuitGuard } from './quit-guard';
import { Updater } from './updater';

app.setName('AI');
// After setName, which names the log folder (~/Library/Logs/AI/main.log on macOS): main-process
// console output and uncaught errors reach a file that packaged builds keep. The file follows
// Electron's `logs` path, which the test profile below redirects; electron-log's default library
// folder would not.
log.transports.file.resolvePathFn = (variables) =>
  join(
    variables.electronDefaultDir ?? variables.libraryDefaultDir,
    variables.fileName ?? 'main.log',
  );
log.errorHandler.startCatching();
Object.assign(console, log.functions);
nativeTheme.themeSource = 'dark';

// Explicit profiles isolate both development and packaged smoke checks from real task data.
if (process.env.AI_TEST_USER_DATA) {
  app.setPath('userData', process.env.AI_TEST_USER_DATA);
  // `logs` holds main.log and does not follow userData.
  app.setPath('logs', join(process.env.AI_TEST_USER_DATA, 'logs'));
}

/** The command a settings-window editor hands to the panel; `null` starts a new command. */
const CommandSessionIdSchema = Type.Union([Identifier, Type.Null()]);

let panel: BrowserWindow | null = null;
const placement = new PanelPlacement(() => panel);
const dock = new DockVisibility();
/** Held for the app's lifetime: a status item without a reference is garbage-collected. */
let menuBar: MenuBarItem | undefined;
let settings: SettingsService;
let agent: AgentService | undefined;
let serviceManager: ServiceManager | undefined;
let choosingFiles = false;
let changingPinned = false;
const quitGuard = installQuitGuard({
  service: () => (agent ? serviceManager : undefined),
  closeAgent: async () => {
    await agent?.close();
  },
  onCancelled: () => {
    if (!panel) void createPanel();
  },
  // The quit prompt is a sheet on the panel, so the panel shows first.
  promptParent: () => {
    showPanel();
    return panel && !panel.isDestroyed() && panel.isVisible() ? panel : null;
  },
});

function showPanel() {
  if (!panel || panel.isDestroyed() || choosingFiles) return;
  if (panel.isMinimized()) panel.restore();
  panel.show();
  panel.focus();
}

/**
 * The global shortcut and the menu bar status item share one toggle: a focused panel hides, any
 * other panel re-docks bottom-right and is revealed. Both capture the frontmost app's selection
 * before the panel takes focus.
 */
function togglePanel() {
  if (!panel || panel.isDestroyed() || choosingFiles) return;
  if (panel.isVisible() && !panel.isMinimized() && panel.isFocused()) {
    hidePanel();
    return;
  }
  agent?.commands.captureSelection();
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  // Re-dock the panel without discarding a size the user resized to.
  panel.setBounds(placement.dockedBounds(display.workArea, panel.getNormalBounds()));
  showPanel();
}

function hidePanel() {
  if (!panel || panel.isDestroyed() || choosingFiles) return;
  // Keep a taskbar restore path when another app has claimed the global shortcut.
  if (!settings.shortcutAvailable && process.platform !== 'darwin') panel.minimize();
  else panel.hide();
}

function assertPanelSender(event: IpcMainInvokeEvent) {
  if (!isWindowSender(event, panel)) {
    throw new Error('Untrusted desktop request');
  }
}

async function withFileDialog<T>(operation: () => Promise<T>): Promise<T> {
  if (choosingFiles || changingPinned)
    throw new Error('Finish the current window operation first.');
  const window = panel;
  const pinned = window?.isAlwaysOnTop() ?? false;
  choosingFiles = true;
  try {
    window?.setAlwaysOnTop(false);
    return await operation();
  } finally {
    choosingFiles = false;
    if (window && !window.isDestroyed()) window.setAlwaysOnTop(pinned);
  }
}

function installIpc() {
  ipcMain.handle(IPC.chooseFiles, async (event) => {
    assertPanelSender(event);
    if (choosingFiles) throw new Error('A file chooser is already open');
    if (changingPinned) throw new Error('Wait for the window preference to finish saving');
    const window = panel!;
    const pinned = window.isAlwaysOnTop();
    choosingFiles = true;
    try {
      // Keep the floating panel below the independent native modal.
      window.setAlwaysOnTop(false);
      return await chooseContextFiles();
    } finally {
      choosingFiles = false;
      if (!window.isDestroyed()) window.setAlwaysOnTop(pinned);
    }
  });
  ipcMain.handle(IPC.show, (event) => {
    assertPanelSender(event);
    showPanel();
  });
  ipcMain.handle(IPC.hide, (event) => {
    assertPanelSender(event);
    hidePanel();
  });
  ipcMain.handle(IPC.getState, (event): DesktopState => {
    settings.assertSender(event);
    return settings.desktopState();
  });
  /**
   * The command editor hands off to the panel: send the session first so the renderer can open it
   * before the panel becomes visible, and surface a deleted command's error to the settings window.
   */
  ipcMain.handle(SETTINGS_IPC.startCommandSession, (event, value: unknown) => {
    settings.assertSender(event);
    const commandId = parse(CommandSessionIdSchema, value);
    const name = commandId === null ? '' : (agent?.commands.find(commandId)?.name ?? '');
    const window = panel;
    if (!window || window.isDestroyed()) throw new Error('The task panel is not available');
    const session: CommandSession = { commandId, name };
    window.webContents.send(AGENT_IPC.session, session);
    showPanel();
  });
  /**
   * Extensions create-with-AI hands off to the panel: seed the skill prompt and policy first so the
   * renderer can open a draft before the panel becomes visible.
   */
  ipcMain.handle(SETTINGS_IPC.startExtensionSession, (event, value: unknown) => {
    settings.assertSender(event);
    const kind = parse(ExtensionSessionKindSchema, value);
    const window = panel;
    if (!window || window.isDestroyed()) throw new Error('The task panel is not available');
    const session: ExtensionSession = { kind };
    window.webContents.send(AGENT_IPC.extensionSession, session);
    showPanel();
  });
  ipcMain.handle(IPC.setPinned, async (event, pinned: unknown) => {
    settings.assertSender(event);
    if (typeof pinned !== 'boolean') throw new TypeError('Pinned must be a boolean');
    if (choosingFiles) throw new Error('Close the file chooser before changing window settings');
    if (changingPinned) throw new Error('A window preference is already being saved');
    changingPinned = true;
    try {
      return await settings.setPinned(pinned);
    } finally {
      changingPinned = false;
    }
  });
}

/** `reveal: false` creates the panel hidden, for a launch the OS started at login. */
async function createPanel({ reveal = true }: { reveal?: boolean } = {}) {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const window = createPanelWindow({
    bounds: placement.dockedBounds(workArea, settings.panelSize),
    workArea,
    pinned: settings.pinned,
    saveSize: (size) => settings.setPanelSize(size),
  });
  panel = window;
  // macOS owns its window management: the native close button dismisses the panel like the
  // in-panel hide control does, so the global shortcut, the menu bar status item and the app menu
  // reveal the same window again. Quitting releases it normally. Every other platform keeps its previous close behavior.
  if (process.platform === 'darwin') {
    window.on('close', (event) => {
      if (quitGuard.isQuitting()) return;
      event.preventDefault();
      hidePanel();
    });
  }
  window.on('closed', () => {
    panel = null;
  });
  if (reveal) window.once('ready-to-show', showPanel);

  await loadWindowContent(window);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showPanel);
  app
    .whenReady()
    .then(async () => {
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      settings = await SettingsService.create({
        panel: () => panel,
        applyPinned: (pinned) => {
          if (panel && !panel.isDestroyed()) panel.setAlwaysOnTop(pinned);
        },
        validateShortcuts: (shortcuts) => agent?.commands.assertSettings(shortcuts),
        togglePanel,
        applyShowInDock: (show) => dock.apply(show),
      });
      void dock.apply(settings.showInDock);
      // T6 pure client: main owns the service connection (bearer token stays
      // in main) plus explicit desktop APIs. No agent execution here.
      serviceManager = new ServiceManager(
        (channel, value) => settings.send(channel, value),
        (event) => settings.assertSender(event),
        {
          panelVisible: () =>
            Boolean(panel && !panel.isDestroyed() && panel.isVisible() && !panel.isMinimized()),
          withDialog: withFileDialog,
        },
        (connected) => {
          // Commands load independently of providers; catalog refresh reads the loaded providers.
          void settings.providers.sync().then(() => {
            if (connected) settings.providers.syncCatalogs();
          });
          if (connected) void agent?.syncLive();
        },
      );
      settings.attach(serviceManager.connection);
      agent = await AgentService.create(
        settings,
        (prepared, autoRun) => {
          // The renderer reveals the panel after it shows the launched command or its task, so a
          // launch never flashes an unrelated page first.
          panel?.webContents.send(AGENT_IPC.launch, { prepared, autoRun });
        },
        withFileDialog,
        serviceManager.connection,
      );
      agent.installIpc();
      serviceManager.installIpc();
      settings.installIpc();
      installIpc();
      installFileSearch(() => panel, serviceManager.connection);
      const manager = serviceManager;
      // A restart into an update cannot be cancelled once it starts, so running tasks are
      // confirmed first.
      const updates = new Updater({ confirmRestart: () => quitGuard.confirmStopTasks() });
      const actions = {
        showPanel,
        hidePanel,
        settings,
        openInBrowser: () => manager.openInBrowser(),
        restartService: () => manager.restart(),
        showServiceLogs: () => manager.revealLogs(),
        updates,
      };
      installAppMenu(actions);
      // The status item's menu rebuilds on every open; the application menu does not.
      updates.onChange(() => installAppMenu(actions));
      const tasks = agent;
      menuBar = new MenuBarItem({
        toggle: togglePanel,
        items: () => appItems(actions),
        tasks: () => tasks.taskStates(),
        onTasksChanged: (listener) => tasks.onTasksChanged(listener),
        connection: () => manager.connection.status().state,
        onConnectionChanged: (listener) => manager.connection.onState(listener),
      });
      menuBar.install();
      const starting = serviceManager.autostart();
      placement.install();
      // Opened at login, the app waits in the menu bar instead of showing the panel.
      await createPanel({ reveal: !openedAtLogin() });
      await starting;
      app.on('activate', () => {
        if (panel) showPanel();
        else void createPanel();
      });
    })
    .catch((error: unknown) => {
      console.error('Could not start the task panel:', error);
      app.exit(1);
    });
}

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
