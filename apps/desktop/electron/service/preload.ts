import { ipcRenderer, type IpcRendererEvent } from 'electron';
import { SERVICE_IPC, type ServiceBridge, type ServiceEvent, type ServiceRequest } from './ipc';

function invoke<T>(request: ServiceRequest): Promise<T> {
  return ipcRenderer.invoke(SERVICE_IPC.request, request) as Promise<T>;
}

export const serviceBridge: ServiceBridge = {
  status: () => invoke({ action: 'status' }),
  connect: (dataDir) => invoke({ action: 'connect', dataDir }),
  disconnect: () => invoke({ action: 'disconnect' }),
  startLocal: (dataDir, port) =>
    invoke({ action: 'startLocal', dataDir, ...(port !== undefined ? { port } : {}) }),
  skills: () => invoke({ action: 'skills' }),
  updateSkill: (name) => invoke({ action: 'skillsUpdate', name }),
  setSkillEnabled: (name, enabled) => invoke({ action: 'skillsSetEnabled', name, enabled }),
  roles: () => invoke({ action: 'roles' }),
  putRole: (input) => invoke({ action: 'rolesPut', ...input }),
  mcpStatus: () => invoke({ action: 'mcpStatus' }),
  mcpConnect: (serverId) => invoke({ action: 'mcpConnect', serverId }),
  mcpAuthStart: (serverId) => invoke({ action: 'mcpAuthStart', serverId }),
  mcpAuthComplete: (serverId, input) => invoke({ action: 'mcpAuthComplete', serverId, input }),
  mcpUpsert: (input) => invoke({ action: 'mcpUpsert', ...input }),
  mcpDisable: (serverId) => invoke({ action: 'mcpDisable', serverId }),
  mcpRemove: (serverId) => invoke({ action: 'mcpRemove', serverId }),
  onChange: (listener) => {
    const callback = (_event: IpcRendererEvent, event: ServiceEvent) => listener(event);
    ipcRenderer.on(SERVICE_IPC.changed, callback);
    return () => ipcRenderer.removeListener(SERVICE_IPC.changed, callback);
  },
};
