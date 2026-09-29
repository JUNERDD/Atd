import { app } from 'electron';
import type { BrowserWindow, IpcMainInvokeEvent, WebPreferences } from 'electron';
import path from 'node:path';

export const rendererPreferences: WebPreferences = {
  preload: path.join(import.meta.dirname, 'preload.cjs'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  transparent: true,
  webSecurity: true,
  spellcheck: false,
};

export function isWindowSender(event: IpcMainInvokeEvent, window: BrowserWindow | null): boolean {
  return Boolean(
    window &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame,
  );
}

/**
 * Pushes a fire-and-forget message to a window's page. A renderer that crashed or was killed
 * leaves the window and its webContents alive while the main frame is disposed, and Electron logs
 * every send to such a frame as an error; the message is dropped instead, because a page that
 * loads again reads the current state on mount.
 */
export function sendToPage(window: BrowserWindow | null, channel: string, value: unknown) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) return;
  const frame = window.webContents.mainFrame;
  if (!frame.isDestroyed()) frame.send(channel, value);
}

/** Records why a window's renderer exited, since its page stays blank until it loads again. */
export function reportRendererExit(window: BrowserWindow, name: string) {
  window.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    console.error(`The ${name} renderer exited (${details.reason}, code ${details.exitCode}).`);
  });
}

export function secureWindowContent(window: BrowserWindow) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
}

export async function loadWindowContent(window: BrowserWindow, hash = '') {
  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (!app.isPackaged && developmentUrl) {
    const parsed = new URL(developmentUrl);
    if (
      parsed.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error('The development server must use the local loopback address');
    }
    // vite-plugin-electron normalizes loopback hosts to localhost; Vite binds IPv4 here.
    parsed.hostname = '127.0.0.1';
    parsed.hash = hash;
    await window.loadURL(parsed.href);
  } else {
    // A packaged app ships the renderer in Resources/web (the `dist-native` build); a local build
    // loads Vite's `dist`.
    const page = app.isPackaged
      ? path.join(process.resourcesPath, 'web', 'index.html')
      : path.join(import.meta.dirname, '../dist/index.html');
    await window.loadFile(page, { hash });
  }
}
