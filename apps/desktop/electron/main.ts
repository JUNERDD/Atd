import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeTheme,
  screen,
  session,
} from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { IPC, type DesktopState } from './contract';
import { chooseContextFiles } from './context-files';
import { SettingsService } from './settings-service';
import {
  isWindowSender,
  loadWindowContent,
  rendererPreferences,
  secureWindowContent,
} from './window-content';
import { constrainPanelBounds, getPanelBounds } from './window-position';

app.setName('AI');
nativeTheme.themeSource = 'dark';

// A separate profile lets the smoke test run without reading or changing real tasks.
if (!app.isPackaged && process.env.AI_TEST_USER_DATA) {
  app.setPath('userData', process.env.AI_TEST_USER_DATA);
}

let panel: BrowserWindow | null = null;
let settings: SettingsService;
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
  ipcMain.handle(IPC.hide, (event) => {
    assertPanelSender(event);
    hidePanel();
  });
  ipcMain.handle(IPC.getState, (event): DesktopState => {
    settings.assertSender(event);
    return settings.desktopState();
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

async function createPanel() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const window = new BrowserWindow({
    ...getPanelBounds(display.workArea),
    title: 'AI',
    frame: false,
    // macOS vibrancy owns the window surface, including its native edge and shadow.
    transparent: process.platform !== 'darwin',
    // The renderer owns the panel tint; keep the native backing clear to avoid double fills.
    backgroundColor: '#00000000',
    alwaysOnTop: settings.pinned,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
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
  window.on('closed', () => {
    panel = null;
  });
  window.once('ready-to-show', showPanel);

  await loadWindowContent(window);
}

function installMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'AI',
        submenu: [
          { label: 'Show task panel', click: showPanel },
          { label: 'Hide task panel', click: hidePanel },
          {
            label: 'Settings…',
            click: () => {
              void settings
                .open()
                .catch(() =>
                  dialog.showErrorBox(
                    'Could not open settings',
                    'The settings window could not be opened.',
                  ),
                );
            },
          },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      { role: 'editMenu' },
      ...(!app.isPackaged ? [{ role: 'viewMenu' as const }] : []),
    ]),
  );
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
        togglePanel: () => {
          if (!panel || panel.isDestroyed() || choosingFiles) return;
          if (panel.isVisible() && !panel.isMinimized() && panel.isFocused()) hidePanel();
          else {
            const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
            panel.setBounds(getPanelBounds(display.workArea));
            showPanel();
          }
        },
      });
      settings.installIpc();
      installIpc();
      installMenu();
      await createPanel();
      const reposition = () => {
        if (!panel || panel.isDestroyed()) return;
        const display = screen.getDisplayMatching(panel.getBounds());
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
