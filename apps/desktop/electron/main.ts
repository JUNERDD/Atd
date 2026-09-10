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
import { SettingsService } from './settings-service';
import {
  isWindowSender,
  loadWindowContent,
  rendererPreferences,
  secureWindowContent,
} from './window-content';
import { getPanelBounds } from './window-position';

app.setName('AI');
nativeTheme.themeSource = 'dark';

// A separate profile lets the smoke test run without reading or changing real tasks.
if (!app.isPackaged && process.env.AI_TEST_USER_DATA) {
  app.setPath('userData', process.env.AI_TEST_USER_DATA);
}

let panel: BrowserWindow | null = null;
let settings: SettingsService;

function showPanel() {
  if (!panel || panel.isDestroyed()) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  panel.setBounds(getPanelBounds(display.workArea));
  if (panel.isMinimized()) panel.restore();
  panel.show();
  panel.focus();
}

function hidePanel() {
  if (!panel || panel.isDestroyed()) return;
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
  ipcMain.handle(IPC.hide, (event) => {
    assertPanelSender(event);
    hidePanel();
  });
  ipcMain.handle(IPC.getState, (event): DesktopState => {
    settings.assertSender(event);
    return settings.desktopState();
  });
  ipcMain.handle(IPC.setPinned, (event, pinned: unknown) => {
    settings.assertSender(event);
    if (typeof pinned !== 'boolean') throw new TypeError('Pinned must be a boolean');
    return settings.setPinned(pinned);
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
          if (panel?.isVisible() && !panel.isMinimized() && panel.isFocused()) hidePanel();
          else showPanel();
        },
      });
      settings.installIpc();
      installIpc();
      installMenu();
      await createPanel();
      const reposition = () => {
        if (!panel || panel.isDestroyed()) return;
        const display = screen.getDisplayMatching(panel.getBounds());
        panel.setBounds(getPanelBounds(display.workArea));
      };
      screen.on('display-metrics-changed', reposition);
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
