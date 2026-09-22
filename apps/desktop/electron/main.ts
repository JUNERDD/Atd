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
import { Type } from 'typebox';
import { AgentService } from './agent/service';
import { AGENT_IPC, type CommandSession, type ExtensionSession } from './agent/bridge';
import { Identifier } from './agent/command-schema';
import { parse } from './agent/validation';
import { IPC, type DesktopState } from './contract';
import { chooseContextFiles } from './context-files';
import { installAppMenu } from './app-menu';
import { ServiceManager } from './service/manager';
import { SETTINGS_IPC } from './settings-contract';
import { SettingsService } from './settings-service';
import {
  isWindowSender,
  loadWindowContent,
  rendererPreferences,
  secureWindowContent,
} from './window-content';
import { constrainPanelBounds, getPanelBounds, getPanelMinimumSize } from './window-position';

app.setName('AI');
nativeTheme.themeSource = 'dark';

// Explicit profiles isolate both development and packaged smoke checks from real task data.
if (process.env.AI_TEST_USER_DATA) {
  app.setPath('userData', process.env.AI_TEST_USER_DATA);
}

let panel: BrowserWindow | null = null;
let settings: SettingsService;
let agent: AgentService | undefined;
let serviceManager: ServiceManager | undefined;
let quitting = false;
let choosingFiles = false;
let changingPinned = false;

function showPanel() {
  if (!panel || panel.isDestroyed() || choosingFiles) return;
  if (panel.isMinimized()) panel.restore();
  panel.show();
  panel.focus();
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
    const commandId = parse(Type.Union([Identifier, Type.Null()]), value);
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
    const kind = parse(
      Type.Union([Type.Literal('skill'), Type.Literal('subagent'), Type.Literal('mcp')]),
      value,
    );
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

/**
 * Only a manual edge drag replaces the stored size; programmatic re-docking and
 * work-area clamping keep the user's preference. The trailing debounce saves the
 * final bounds once the drag settles.
 */
function rememberPanelSize(window: BrowserWindow) {
  let pending: ReturnType<typeof setTimeout> | undefined;
  window.on('will-resize', () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      if (window.isDestroyed()) return;
      const { width, height } = window.getNormalBounds();
      settings.setPanelSize({ width, height }).catch((error: unknown) => {
        console.error('Could not save the panel size:', error);
      });
    }, 300);
  });
}

async function createPanel() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  // macOS vibrancy owns the window surface, including its native edge and shadow.
  // Other platforms need a transparent backing, which Electron cannot resize reliably.
  const transparent = process.platform !== 'darwin';
  const minimum = getPanelMinimumSize(display.workArea);
  const window = new BrowserWindow({
    ...getPanelBounds(display.workArea, settings.panelSize),
    title: 'AI',
    // macOS keeps its native traffic lights over a hidden title bar; every other platform draws
    // the panel chrome in the renderer instead.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 16, y: 18 } }
      : { frame: false }),
    transparent,
    // The renderer owns the panel tint; keep the native backing clear to avoid double fills.
    backgroundColor: '#00000000',
    alwaysOnTop: settings.pinned,
    resizable: !transparent,
    // The macOS traffic lights replace the in-panel chrome, so the green button stays enabled and
    // zooms the panel; like the settings window it never enters fullscreen.
    maximizable: true,
    fullscreenable: false,
    minWidth: minimum.width,
    minHeight: minimum.height,
    hasShadow: true,
    roundedCorners: true,
    show: false,
    // HUD provides native blur beneath the renderer's content surface, even when unfocused.
    ...(process.platform === 'darwin'
      ? { vibrancy: 'hud' as const, visualEffectState: 'active' as const }
      : {}),
    webPreferences: rendererPreferences,
  });
  panel = window;
  secureWindowContent(window);
  rememberPanelSize(window);
  // macOS owns its window management: the native close button dismisses the panel like the
  // in-panel hide control does, so the global shortcut and the app menu reveal the same window
  // again. Quitting releases it normally. Every other platform keeps its previous close behavior.
  if (process.platform === 'darwin') {
    window.on('close', (event) => {
      if (quitting) return;
      event.preventDefault();
      hidePanel();
    });
  }
  window.on('closed', () => {
    panel = null;
  });
  window.once('ready-to-show', showPanel);

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
        togglePanel: () => {
          if (!panel || panel.isDestroyed() || choosingFiles) return;
          if (panel.isVisible() && !panel.isMinimized() && panel.isFocused()) hidePanel();
          else {
            agent?.commands.captureSelection();
            const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
            // Re-dock the panel without discarding a size the user resized to.
            panel.setBounds(getPanelBounds(display.workArea, panel.getNormalBounds()));
            showPanel();
          }
        },
      });
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
          void settings.providers.sync().then(() => {
            if (connected) return agent?.syncLive();
            return undefined;
          });
        },
      );
      settings.providers.attach(serviceManager.connection);
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
      installAppMenu(showPanel, hidePanel, settings);
      const starting = serviceManager.autostart();
      await createPanel();
      await starting;
      const reposition = () => {
        if (!panel || panel.isDestroyed()) return;
        const display = screen.getDisplayMatching(panel.getBounds());
        const minimum = getPanelMinimumSize(display.workArea);
        panel.setMinimumSize(minimum.width, minimum.height);
        const bounds = panel.getBounds();
        const next = constrainPanelBounds(bounds, display.workArea);
        if (
          next.x !== bounds.x ||
          next.y !== bounds.y ||
          next.width !== bounds.width ||
          next.height !== bounds.height
        )
          panel.setBounds(next);
      };
      screen.on('display-metrics-changed', (_event, display, metrics) => {
        if (!panel || panel.isDestroyed()) return;
        if (!metrics.some((metric) => ['bounds', 'workArea', 'scaleFactor'].includes(metric)))
          return;
        if (display.id === screen.getDisplayMatching(panel.getBounds()).id) reposition();
      });
      screen.on('display-removed', reposition);
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

app.on('before-quit', (event) => {
  if (quitting || !agent) return;
  event.preventDefault();
  quitting = true;
  void (async () => {
    try {
      await serviceManager?.shutdown();
      await agent?.close();
    } finally {
      app.quit();
    }
  })();
});
