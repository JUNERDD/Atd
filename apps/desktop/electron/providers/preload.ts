import { ipcRenderer, type IpcRendererEvent } from 'electron';
import { PROVIDER_IPC } from './ipc-channels';
// Type-only: a value import would bundle the provider schemas into the preload.
import type {
  ProviderBridge,
  ProviderCatalogEntry,
  Connection,
  LoginState,
  ModelThinkingLevel,
} from './schema';

export const providerBridge: ProviderBridge = {
  catalog: () => ipcRenderer.invoke(PROVIDER_IPC.catalog) as Promise<ProviderCatalogEntry[]>,
  save: (draft) => ipcRenderer.invoke(PROVIDER_IPC.save, draft) as Promise<Connection>,
  setDefault: (id, revision) =>
    ipcRenderer.invoke(PROVIDER_IPC.default, id, revision) as Promise<void>,
  setModel: (reference, revision, thinkingLevel) =>
    ipcRenderer.invoke(PROVIDER_IPC.model, reference, revision, thinkingLevel) as Promise<void>,
  levels: (reference) =>
    ipcRenderer.invoke(PROVIDER_IPC.levels, reference) as Promise<ModelThinkingLevel[]>,
  disconnect: (id, revision) =>
    ipcRenderer.invoke(PROVIDER_IPC.disconnect, id, revision) as Promise<void>,
  refresh: (id) => ipcRenderer.invoke(PROVIDER_IPC.refresh, id) as Promise<void>,
  refreshCatalogs: () => ipcRenderer.invoke(PROVIDER_IPC.refreshCatalogs) as Promise<void>,
  verify: (reference) => ipcRenderer.invoke(PROVIDER_IPC.verify, reference) as Promise<void>,
  login: (id) => ipcRenderer.invoke(PROVIDER_IPC.login, id) as Promise<LoginState>,
  answer: (id, promptId, value) =>
    ipcRenderer.invoke(PROVIDER_IPC.answer, id, promptId, value) as Promise<void>,
  cancel: (id) => ipcRenderer.invoke(PROVIDER_IPC.cancel, id) as Promise<void>,
  openLink: (id) => ipcRenderer.invoke(PROVIDER_IPC.openLink, id) as Promise<void>,
  onLogin: (listener) => {
    const callback = (_event: IpcRendererEvent, state: LoginState) => listener(state);
    ipcRenderer.on(PROVIDER_IPC.loginEvent, callback);
    return () => ipcRenderer.removeListener(PROVIDER_IPC.loginEvent, callback);
  },
};
