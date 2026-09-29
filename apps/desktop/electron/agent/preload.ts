import { ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  createAgentBridge,
  type AgentChannel,
  type AgentChannelValues,
} from '../../src/client/agent/bridge-client';
import { AGENT_IPC } from '../../src/client/agent/ipc-channels';

export const agentBridge = createAgentBridge(
  (request) => ipcRenderer.invoke(AGENT_IPC.request, request),
  <C extends AgentChannel>(channel: C, listener: (value: AgentChannelValues[C]) => void) => {
    const callback = (_event: IpcRendererEvent, value: AgentChannelValues[C]) => listener(value);
    ipcRenderer.on(AGENT_IPC[channel], callback);
    return () => ipcRenderer.removeListener(AGENT_IPC[channel], callback);
  },
);
