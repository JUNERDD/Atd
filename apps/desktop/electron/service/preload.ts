import { ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ServiceEvent } from './ipc';
import { createServiceBridge } from './bridge-client';
import { SERVICE_IPC } from './ipc-channels';

export const serviceBridge = createServiceBridge(
  (request) => ipcRenderer.invoke(SERVICE_IPC.request, request),
  (listener) => {
    const callback = (_event: IpcRendererEvent, event: ServiceEvent) => listener(event);
    ipcRenderer.on(SERVICE_IPC.changed, callback);
    return () => ipcRenderer.removeListener(SERVICE_IPC.changed, callback);
  },
);
