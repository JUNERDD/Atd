import { ipcRenderer, type IpcRendererEvent } from 'electron';
// Type-only: a value import would bundle bridge.ts's request schemas into the preload.
import type {
  AgentBridge,
  AgentEvent,
  AgentRequest,
  CommandLaunch,
  CommandSession,
  ExtensionSession,
} from './bridge';
import { AGENT_IPC } from './ipc-channels';

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
  queueMessage: (taskId, text, mode) => invoke({ action: 'queueMessage', taskId, text, mode }),
  replaceQueue: (taskId, followUp) => invoke({ action: 'replaceQueue', taskId, followUp }),
  setPermissionTier: (taskId, tier) => invoke({ action: 'setPermissionTier', taskId, tier }),
  renameTask: (taskId, title) => invoke({ action: 'renameTask', taskId, title }),
  deleteTask: (taskId) => invoke({ action: 'deleteTask', taskId }),
  chooseFiles: () => invoke({ action: 'chooseFiles' }),
  memory: () => invoke({ action: 'memory' }),
  pauseMemory: (paused) => invoke({ action: 'pauseMemory', paused }),
  updateMemory: (entry, content) => invoke({ action: 'updateMemory', entry, content }),
  artifact: (artifactId, operation) => invoke({ action: 'artifact', artifactId, operation }),
  copy: (text) => invoke({ action: 'copy', text }),
  openLink: (url) => invoke({ action: 'openLink', url }),
  importLegacy: (json) => invoke({ action: 'importLegacy', json }),
  childTranscript: (taskId, childKey) => invoke({ action: 'childTranscript', taskId, childKey }),
  releaseChildTranscript: (taskId, childKey) =>
    invoke({ action: 'releaseChildTranscript', taskId, childKey }),
  onChange: (listener) => {
    const callback = (_event: IpcRendererEvent, event: AgentEvent) => listener(event);
    ipcRenderer.on(AGENT_IPC.changed, callback);
    return () => ipcRenderer.removeListener(AGENT_IPC.changed, callback);
  },
  onLaunch: (listener) => {
    const callback = (_event: IpcRendererEvent, launch: CommandLaunch) => listener(launch);
    ipcRenderer.on(AGENT_IPC.launch, callback);
    return () => ipcRenderer.removeListener(AGENT_IPC.launch, callback);
  },
  onCommandSession: (listener) => {
    const callback = (_event: IpcRendererEvent, session: CommandSession) => listener(session);
    ipcRenderer.on(AGENT_IPC.session, callback);
    return () => ipcRenderer.removeListener(AGENT_IPC.session, callback);
  },
  onExtensionSession: (listener) => {
    const callback = (_event: IpcRendererEvent, session: ExtensionSession) => listener(session);
    ipcRenderer.on(AGENT_IPC.extensionSession, callback);
    return () => ipcRenderer.removeListener(AGENT_IPC.extensionSession, callback);
  },
};
