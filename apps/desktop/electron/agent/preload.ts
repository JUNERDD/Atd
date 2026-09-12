import { ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  AGENT_IPC,
  type AgentBridge,
  type AgentEvent,
  type AgentRequest,
  type PreparedCommand,
} from './bridge';

function invoke<T>(request: AgentRequest): Promise<T> {
  return ipcRenderer.invoke(AGENT_IPC.request, request) as Promise<T>;
}

export const agentBridge: AgentBridge = {
  get: () => invoke({ action: 'get' }),
  detail: (taskId) => invoke({ action: 'detail', taskId }),
  saveCommand: (command, expectedRevision) =>
    invoke({ action: 'saveCommand', command, expectedRevision }),
  deleteCommand: (commandId, revision) => invoke({ action: 'deleteCommand', commandId, revision }),
  launch: (commandId, prepared) =>
    invoke({ action: 'launch', commandId, prepared: prepared ?? null }),
  prepare: (commandId) => invoke({ action: 'prepare', commandId }),
  capture: (source) => invoke({ action: 'capture', source }),
  preview: (input, command, policy = null) => invoke({ action: 'preview', input, command, policy }),
  submit: (request) => invoke({ action: 'submit', ...request }),
  stop: (taskId, runId) => invoke({ action: 'stop', taskId, runId }),
  answer: (taskId, runId, requestId, answer) =>
    invoke({ action: 'answer', taskId, runId, requestId, answer }),
  deleteTask: (taskId) => invoke({ action: 'deleteTask', taskId }),
  chooseFiles: () => invoke({ action: 'chooseFiles' }),
  memory: () => invoke({ action: 'memory' }),
  pauseMemory: (paused) => invoke({ action: 'pauseMemory', paused }),
  updateMemory: (entry, content) => invoke({ action: 'updateMemory', entry, content }),
  artifact: (artifactId, operation) => invoke({ action: 'artifact', artifactId, operation }),
  copy: (text) => invoke({ action: 'copy', text }),
  openLink: (url) => invoke({ action: 'openLink', url }),
  importLegacy: (json) => invoke({ action: 'importLegacy', json }),
  onChange: (listener) => {
    const callback = (_event: IpcRendererEvent, event: AgentEvent) => listener(event);
    ipcRenderer.on(AGENT_IPC.changed, callback);
    return () => ipcRenderer.removeListener(AGENT_IPC.changed, callback);
  },
  onLaunch: (listener) => {
    const callback = (_event: IpcRendererEvent, prepared: PreparedCommand) => listener(prepared);
    ipcRenderer.on(AGENT_IPC.launch, callback);
    return () => ipcRenderer.removeListener(AGENT_IPC.launch, callback);
  },
};
