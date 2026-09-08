import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type DesktopBridge, type DesktopState } from './contract';

const desktop: DesktopBridge = {
  hide: () => ipcRenderer.invoke(IPC.hide) as Promise<void>,
  getState: () => ipcRenderer.invoke(IPC.getState) as Promise<DesktopState>,
  setPinned: (pinned) => ipcRenderer.invoke(IPC.setPinned, pinned) as Promise<boolean>,
};

contextBridge.exposeInMainWorld('desktop', desktop);
