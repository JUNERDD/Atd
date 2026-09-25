// Type-only: a value import would bundle the request schemas into the preload.
import type { ServiceBridge, ServiceEvent, ServiceRequest } from './ipc';

/**
 * The service bridge over a transport: IPC in the desktop, direct calls in the web client. The
 * transport answers `unknown`; each method states the result its request produces.
 */
export function createServiceBridge(
  transport: (request: ServiceRequest) => Promise<unknown>,
  listen: (listener: (event: ServiceEvent) => void) => () => void,
): ServiceBridge {
  const invoke = <T>(request: ServiceRequest) => transport(request) as Promise<T>;
  return {
    status: () => invoke({ action: 'status' }),
    connect: (dataDir) => invoke({ action: 'connect', dataDir }),
    disconnect: () => invoke({ action: 'disconnect' }),
    openInBrowser: () => invoke({ action: 'openInBrowser' }),
    startLocal: (dataDir, port) =>
      invoke({ action: 'startLocal', dataDir, ...(port !== undefined ? { port } : {}) }),
    skills: () => invoke({ action: 'skills' }),
    updateSkill: (name) => invoke({ action: 'skillsUpdate', name }),
    setSkillEnabled: (name, enabled) => invoke({ action: 'skillsSetEnabled', name, enabled }),
    installSkill: (input) => invoke({ action: 'skillsInstall', ...input }),
    restoreBuiltin: (id) => invoke({ action: 'builtinRestore', id }),
    roles: () => invoke({ action: 'roles' }),
    putRole: (input) => invoke({ action: 'rolesPut', ...input }),
    agents: () => invoke({ action: 'agents' }),
    putAgent: (input) => invoke({ action: 'agentsPut', ...input }),
    mcpStatus: () => invoke({ action: 'mcpStatus' }),
    mcpConnect: (serverId) => invoke({ action: 'mcpConnect', serverId }),
    mcpAuthStart: (serverId) => invoke({ action: 'mcpAuthStart', serverId }),
    mcpAuthComplete: (serverId, input) => invoke({ action: 'mcpAuthComplete', serverId, input }),
    mcpUpsert: (input) => invoke({ action: 'mcpUpsert', ...input }),
    mcpDisable: (serverId) => invoke({ action: 'mcpDisable', serverId }),
    mcpRemove: (serverId) => invoke({ action: 'mcpRemove', serverId }),
    onChange: (listener) => listen(listener),
  };
}
