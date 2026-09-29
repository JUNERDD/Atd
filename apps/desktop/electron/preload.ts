import { agentBridge } from './agent/preload';
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { FileSearchReply } from '@ai/agent-contracts';
import type { FileRef } from '../src/client/agent/task-schema';
import {
  IPC,
  type ContextFile,
  type DesktopBridge,
  type DesktopState,
} from '../src/client/contract';
import { SETTINGS_IPC, type SettingsSnapshot } from '../src/client/settings-contract';
import { providerBridge } from './providers/preload';
import { serviceBridge } from './service/preload';

const desktop: DesktopBridge = {
  runtime: 'electron',
  platform: process.platform,
  agent: agentBridge,
  service: serviceBridge,
  files: {
    search: (request) => ipcRenderer.invoke(IPC.searchFiles, request) as Promise<FileSearchReply>,
    attach: (resultIds) => ipcRenderer.invoke(IPC.attachFiles, { resultIds }) as Promise<FileRef[]>,
  },
  settings: {
    open: () => ipcRenderer.invoke(SETTINGS_IPC.open) as Promise<void>,
    openCommand: (commandId: string) =>
      ipcRenderer.invoke(SETTINGS_IPC.openCommand, commandId) as Promise<void>,
    close: () => ipcRenderer.invoke(SETTINGS_IPC.close) as Promise<void>,
    get: () => ipcRenderer.invoke(SETTINGS_IPC.get) as Promise<SettingsSnapshot>,
    startCommandSession: (commandId) =>
      ipcRenderer.invoke(SETTINGS_IPC.startCommandSession, commandId) as Promise<void>,
    startExtensionSession: (kind, target) =>
      ipcRenderer.invoke(SETTINGS_IPC.startExtensionSession, kind, target ?? null) as Promise<void>,
    setLanguage: (language) =>
      ipcRenderer.invoke(SETTINGS_IPC.saveLanguage, language) as Promise<SettingsSnapshot>,
    providers: providerBridge,
    saveShortcuts: (shortcuts) =>
      ipcRenderer.invoke(SETTINGS_IPC.saveShortcuts, shortcuts) as Promise<SettingsSnapshot>,
    restoreShortcuts: () =>
      ipcRenderer.invoke(SETTINGS_IPC.restoreShortcuts) as Promise<SettingsSnapshot>,
    setPermissionTier: (tier) =>
      ipcRenderer.invoke(SETTINGS_IPC.savePermissionTier, tier) as Promise<SettingsSnapshot>,
    saveShellAllowlist: (entries) =>
      ipcRenderer.invoke(SETTINGS_IPC.saveShellAllowlist, entries) as Promise<SettingsSnapshot>,
    addShellAllowlistEntry: (entry) =>
      ipcRenderer.invoke(SETTINGS_IPC.addShellAllowlistEntry, entry) as Promise<SettingsSnapshot>,
    onChange: (listener) => {
      const callback = (_event: IpcRendererEvent, settings: SettingsSnapshot) => listener(settings);
      ipcRenderer.on(SETTINGS_IPC.changed, callback);
      return () => ipcRenderer.removeListener(SETTINGS_IPC.changed, callback);
    },
    onOpenCommand: (listener) => {
      const callback = (_event: IpcRendererEvent, commandId: string) => listener(commandId);
      ipcRenderer.on(SETTINGS_IPC.openCommand, callback);
      return () => ipcRenderer.removeListener(SETTINGS_IPC.openCommand, callback);
    },
  },
  show: () => ipcRenderer.invoke(IPC.show) as Promise<void>,
  hide: () => ipcRenderer.invoke(IPC.hide) as Promise<void>,
  getState: () => ipcRenderer.invoke(IPC.getState) as Promise<DesktopState>,
  setPinned: (pinned) => ipcRenderer.invoke(IPC.setPinned, pinned) as Promise<boolean>,
  setShowInDock: (show) => ipcRenderer.invoke(IPC.setShowInDock, show) as Promise<boolean>,
  setOpenAtLogin: (open) => ipcRenderer.invoke(IPC.setOpenAtLogin, open) as Promise<boolean>,
  chooseFiles: () => ipcRenderer.invoke(IPC.chooseFiles) as Promise<ContextFile[]>,
  onEditCommand: (listener) => {
    const callback = (_event: IpcRendererEvent, command: unknown) => {
      if (command === 'undo' || command === 'redo') listener(command);
    };
    ipcRenderer.on(IPC.editCommand, callback);
    return () => ipcRenderer.removeListener(IPC.editCommand, callback);
  },
};

contextBridge.exposeInMainWorld('desktop', desktop);
