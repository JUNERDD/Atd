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
    await window.loadFile(path.join(import.meta.dirname, '../dist/index.html'), { hash });
  }
}
