import { agentBridge } from './agent/preload';
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import { IPC, type ContextFile, type DesktopBridge, type DesktopState } from './contract';
import { SETTINGS_IPC, type SettingsSnapshot } from './settings-contract';
import { providerBridge } from './providers/preload';
import { GENERATION_IPC, type GenerationResult } from './agent/generation-contract';

const desktop: DesktopBridge = {
  platform: process.platform,
  agent: agentBridge,
  settings: {
    open: () => ipcRenderer.invoke(SETTINGS_IPC.open) as Promise<void>,
    close: () => ipcRenderer.invoke(SETTINGS_IPC.close) as Promise<void>,
    get: () => ipcRenderer.invoke(SETTINGS_IPC.get) as Promise<SettingsSnapshot>,
    providers: providerBridge,
    generation: {
      generate: (request) =>
        ipcRenderer.invoke(GENERATION_IPC.generate, request) as Promise<GenerationResult>,
      cancel: (id) => ipcRenderer.invoke(GENERATION_IPC.cancel, id) as Promise<void>,
    },
    saveShortcuts: (shortcuts) =>
      ipcRenderer.invoke(SETTINGS_IPC.saveShortcuts, shortcuts) as Promise<SettingsSnapshot>,
    restoreShortcuts: () =>
      ipcRenderer.invoke(SETTINGS_IPC.restoreShortcuts) as Promise<SettingsSnapshot>,
    onChange: (listener) => {
      const callback = (_event: IpcRendererEvent, settings: SettingsSnapshot) => listener(settings);
      ipcRenderer.on(SETTINGS_IPC.changed, callback);
      return () => ipcRenderer.removeListener(SETTINGS_IPC.changed, callback);
    },
  },
  hide: () => ipcRenderer.invoke(IPC.hide) as Promise<void>,
  getState: () => ipcRenderer.invoke(IPC.getState) as Promise<DesktopState>,
  setPinned: (pinned) => ipcRenderer.invoke(IPC.setPinned, pinned) as Promise<boolean>,
  chooseFiles: () => ipcRenderer.invoke(IPC.chooseFiles) as Promise<ContextFile[]>,
};

contextBridge.exposeInMainWorld('desktop', desktop);
