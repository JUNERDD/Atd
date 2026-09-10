import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeTheme,
  screen,
  session,
} from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import path from 'node:path';
import { IPC, type DesktopState } from './contract';
import { getPanelBounds } from './window-position';

app.setName('AI');
nativeTheme.themeSource = 'dark';

// A separate profile lets the smoke test run without reading or changing real tasks.
if (!app.isPackaged && process.env.AI_TEST_USER_DATA) {
  app.setPath('userData', process.env.AI_TEST_USER_DATA);
}

let panel: BrowserWindow | null = null;
let shortcutAvailable = false;
const shortcut = 'CommandOrControl+Shift+Space';

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
  if (!shortcutAvailable && process.platform !== 'darwin') panel.minimize();
  else panel.hide();
}

function assertPanelSender(event: IpcMainInvokeEvent) {
  if (
    !panel ||
    event.sender !== panel.webContents ||
    event.senderFrame !== panel.webContents.mainFrame
  ) {
    throw new Error('Untrusted desktop request');
  }
}

function installIpc() {
  ipcMain.handle(IPC.hide, (event) => {
    assertPanelSender(event);
    hidePanel();
  });
  ipcMain.handle(IPC.getState, (event): DesktopState => {
    assertPanelSender(event);
    return {
      pinned: panel!.isAlwaysOnTop(),
      shortcut: process.platform === 'darwin' ? '⌘ ⇧ Space' : 'Ctrl + Shift + Space',
      shortcutAvailable,
    };
  });
  ipcMain.handle(IPC.setPinned, (event, pinned: unknown) => {
    assertPanelSender(event);
    if (typeof pinned !== 'boolean') throw new TypeError('Pinned must be a boolean');
    panel!.setAlwaysOnTop(pinned);
    return panel!.isAlwaysOnTop();
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
    alwaysOnTop: true,
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
    webPreferences: {
      preload: path.join(import.meta.dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      transparent: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  panel = window;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.on('closed', () => {
    panel = null;
  });
  window.once('ready-to-show', showPanel);

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (!app.isPackaged && developmentUrl) {
    const parsed = new URL(developmentUrl);
    if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
      throw new Error('The development server must use the local loopback address');
    }
    // vite-plugin-electron normalizes loopback hosts to localhost; Vite binds IPv4 here.
    parsed.hostname = '127.0.0.1';
    await window.loadURL(parsed.href);
  } else {
    await window.loadFile(path.join(import.meta.dirname, '../dist/index.html'));
  }
}

function installMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'AI',
        submenu: [
          { label: 'Show task panel', click: showPanel },
          { label: 'Hide task panel', click: hidePanel },
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
      shortcutAvailable = globalShortcut.register(shortcut, () => {
        if (panel?.isVisible() && !panel.isMinimized() && panel.isFocused()) hidePanel();
        else showPanel();
      });
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
