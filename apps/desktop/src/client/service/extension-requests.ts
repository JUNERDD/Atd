import {
  deleteAtdAgent,
  deleteSkill,
  getSkill,
  listAtdAgents,
  listRoles,
  listSkills,
  mcpAuthComplete,
  mcpAuthStart,
  mcpConnect,
  mcpRecords,
  mcpRemoveServer,
  mcpSetServerEnabled,
  mcpStatus,
  mcpUpsertServer,
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
import { handleMcpApprovalRequest, type RequestMcpApproval } from './mcp-approval-requests';
import { handlePluginRequest } from './plugin-requests';

/** Service bridge requests about extensions; connection lifecycle stays with each host. */
export type ExtensionRequest = Exclude<
  ServiceRequest,
  { action: 'status' | 'connect' | 'disconnect' | 'startLocal' }
>;

/** What each host serves in its own way: its browser, and its native approval confirmation. */
export interface ExtensionHost {
  /** Shows an MCP authorization page. */
  openExternal: (url: string) => Promise<void>;
  requestMcpApproval: RequestMcpApproval;
}

/**
 * Plugins, skills, roles, subagents, built-ins and MCP servers over the service API, for the macOS
 * shell's page (`native-host`).
 */
export async function handleExtensionRequest(
  options: AgentClientOptions | null,
  request: ExtensionRequest,
  host: ExtensionHost,
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
    case 'skillsDelete':
      return deleteSkill(options, request.name);
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
    case 'agentsDelete':
      return deleteAtdAgent(options, request.name);
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
        await host.openExternal(url.href);
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
      // The form edits no env or header values: leaving both maps out keeps the stored ones, and
      // the service refuses a command or URL change those kept values must not follow.
      return mcpUpsertServer({ options }, request.serverId, {
        transport: request.transport,
        auth: request.auth,
        ...(request.command === undefined ? {} : { command: request.command }),
        ...(request.args === undefined ? {} : { args: request.args }),
        ...(request.url === undefined ? {} : { url: request.url }),
        ...(request.exposure === undefined ? {} : { exposure: request.exposure }),
        ...(request.exposeResources === undefined
          ? {}
          : { exposeResources: request.exposeResources }),
      });
    case 'mcpSetEnabled':
      return mcpSetServerEnabled({ options }, request.serverId, request.enabled);
    case 'mcpRemove':
      return mcpRemoveServer({ options }, request.serverId);
    case 'mcpRequestApproval':
    case 'mcpWithdrawApproval':
    case 'mcpDismissApprovalNotice':
      return handleMcpApprovalRequest(options, request, host.requestMcpApproval);
    case 'plugins':
    case 'pluginsGet':
    case 'pluginsSetEnabled':
    case 'pluginsSetItemEnabled':
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
