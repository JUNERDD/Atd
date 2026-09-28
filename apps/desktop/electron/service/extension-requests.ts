import {
  getSkill,
  listAtdAgents,
  listRoles,
  listSkills,
  mcpAuthComplete,
  mcpAuthStart,
  mcpConnect,
  mcpRecords,
  mcpStatus,
  putAtdAgent,
  putRole,
  readSkillFile,
  restoreBuiltin,
  setAtdAgentEnabled,
  setAtdAgentPermissions,
  setSkillEnabled,
  type AgentClientOptions,
} from '@ai/agent-client';
import type { ServiceRequest } from './ipc';
import { removeMcpServer, setMcpServerEnabled, upsertMcpServer } from './mcp-catalog';
import { handlePluginRequest } from './plugin-requests';

/** Service bridge requests about extensions; connection lifecycle stays with each host. */
export type ExtensionRequest = Exclude<
  ServiceRequest,
  { action: 'status' | 'connect' | 'disconnect' | 'startLocal' | 'openInBrowser' }
>;

/**
 * Plugins, skills, roles, subagents, built-ins and MCP servers over the service API, shared by the
 * desktop main process and the web client. `openExternal` shows an MCP authorization page.
 */
export async function handleExtensionRequest(
  options: AgentClientOptions | null,
  request: ExtensionRequest,
  openExternal: (url: string) => Promise<void>,
): Promise<unknown> {
  if (!options) throw new Error('The service is not connected.');
  switch (request.action) {
    case 'skills':
      return listSkills(options);
    case 'skillsGet':
      return getSkill(options, request.name);
    case 'skillsFile':
      return readSkillFile(options, request.name, request.path);
    case 'skillsSetEnabled':
      return setSkillEnabled(options, request.name, request.enabled);
    case 'builtinRestore':
      return restoreBuiltin(options, request.id);
    case 'roles':
      return listRoles(options);
    case 'rolesPut':
      return putRole(options, { id: request.id, title: request.title, allows: request.allows });
    case 'agents':
      return listAtdAgents(options);
    case 'agentsSetEnabled':
      return setAtdAgentEnabled(options, request.name, request.enabled);
    case 'agentsSetPermissions':
      return setAtdAgentPermissions(options, request.name, request.permissions);
    case 'agentsPut':
      return putAtdAgent(options, {
        name: request.name,
        description: request.description,
        tools: request.tools,
        model: request.model,
        systemPrompt: request.systemPrompt,
      });
    case 'mcpStatus':
      return mcpStatus({ options });
    case 'mcpServers':
      return mcpRecords({ options });
    case 'mcpConnect':
      return mcpConnect({ options }, { serverId: request.serverId });
    case 'mcpAuthStart': {
      const result = await mcpAuthStart({ options }, { serverId: request.serverId });
      if (result.authorizationUrl) {
        const url = new URL(result.authorizationUrl);
        if (!['http:', 'https:'].includes(url.protocol))
          throw new Error('Only web links can be opened.');
        await openExternal(url.href);
      }
      return result;
    }
    case 'mcpAuthComplete': {
      const result = await mcpAuthComplete(
        { options },
        { serverId: request.serverId, input: request.input },
      );
      return { ok: result.authenticated };
    }
    case 'mcpUpsert':
      return upsertMcpServer(options, request);
    case 'mcpSetEnabled':
      return setMcpServerEnabled(options, request.serverId, request.enabled);
    case 'mcpRemove':
      return removeMcpServer(options, request.serverId);
    case 'plugins':
    case 'pluginsGet':
    case 'pluginsSetEnabled':
    case 'pluginsSetItemEnabled':
    case 'pluginsSetApproval':
    case 'pluginsConfigure':
    case 'pluginsDuplicate':
    case 'pluginsPreview':
    case 'pluginsUpdatePreview':
    case 'pluginsInstall':
    case 'pluginsUninstall':
      return handlePluginRequest(options, request);
    default: {
      const _exhaustive: never = request;
      throw new Error(`Unsupported service action: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
