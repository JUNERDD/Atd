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
    skill: (name) => invoke({ action: 'skillsGet', name }),
    skillFile: (name, path) => invoke({ action: 'skillsFile', name, path }),
    setSkillEnabled: (name, enabled) => invoke({ action: 'skillsSetEnabled', name, enabled }),
    restoreBuiltin: (id) => invoke({ action: 'builtinRestore', id }),
    roles: () => invoke({ action: 'roles' }),
    putRole: (input) => invoke({ action: 'rolesPut', ...input }),
    agents: () => invoke({ action: 'agents' }),
    setAgentEnabled: (name, enabled) => invoke({ action: 'agentsSetEnabled', name, enabled }),
    setAgentPermissions: (name, permissions) =>
      invoke({ action: 'agentsSetPermissions', name, permissions }),
    putAgent: (input) => invoke({ action: 'agentsPut', ...input }),
    mcpStatus: () => invoke({ action: 'mcpStatus' }),
    mcpServers: () => invoke({ action: 'mcpServers' }),
    mcpConnect: (serverId) => invoke({ action: 'mcpConnect', serverId }),
    mcpAuthStart: (serverId) => invoke({ action: 'mcpAuthStart', serverId }),
    mcpAuthComplete: (serverId, input) => invoke({ action: 'mcpAuthComplete', serverId, input }),
    mcpUpsert: (input) => invoke({ action: 'mcpUpsert', ...input }),
    mcpSetEnabled: (serverId, enabled) => invoke({ action: 'mcpSetEnabled', serverId, enabled }),
    mcpRemove: (serverId) => invoke({ action: 'mcpRemove', serverId }),
    plugins: () => invoke({ action: 'plugins' }),
    plugin: (id) => invoke({ action: 'pluginsGet', id }),
    setPluginEnabled: (id, enabled) => invoke({ action: 'pluginsSetEnabled', id, enabled }),
    setPluginItemEnabled: (input) => invoke({ action: 'pluginsSetItemEnabled', ...input }),
    setPluginServerApproval: (input) => invoke({ action: 'pluginsSetApproval', ...input }),
    configurePlugin: (id, values) => invoke({ action: 'pluginsConfigure', id, values }),
    duplicatePluginItem: (input) => invoke({ action: 'pluginsDuplicate', ...input }),
    previewPlugin: (source) => invoke({ action: 'pluginsPreview', source }),
    previewPluginUpdate: (id) => invoke({ action: 'pluginsUpdatePreview', id }),
    installPlugin: (previewId) => invoke({ action: 'pluginsInstall', previewId }),
    uninstallPlugin: (id) => invoke({ action: 'pluginsUninstall', id }),
    onChange: (listener) => listen(listener),
  };
}
