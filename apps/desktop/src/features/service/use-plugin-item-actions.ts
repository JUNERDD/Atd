import { useOpenSettingsCommand, useSettingsNavigation } from '../settings/settings-navigation';
import type { ExtensionCommandRow } from './extension-commands';
import type { Extensions } from './use-extensions';

/**
 * What a plugin's item rows do, shared by plugin pages and search results: switches (routed by
 * `useExtensions` to the store that keeps them), subagent permissions, built-in restore, deleting
 * Personal skills, subagents and MCP servers, MCP connection steps and launch approvals, and
 * commands, which open in the Commands section.
 */
export function usePluginItemActions(extensions: Extensions) {
  const navigate = useSettingsNavigation();
  const showCommand = useOpenSettingsCommand();
  const { mutations, mcp } = extensions;

  /** A command not yet in the agent snapshot opens the Commands list instead of its editor. */
  const openCommand = (row: ExtensionCommandRow) =>
    row.id ? showCommand(row.id) : navigate('commands');
  return {
    openCommand,
    setItemEnabled: extensions.setItemEnabled,
    setServiceItemEnabled: extensions.setServiceItemEnabled,
    setAgentPermissions: mutations.setAgentPermissions,
    restoreBuiltin: mutations.restoreBuiltin,
    mcpConnect: (serverId: string) => void mcp.connect(serverId),
    mcpAuthStart: (serverId: string) => void mcp.authStart(serverId),
    mcpAuthComplete: (serverId: string, input: string) => void mcp.authComplete(serverId, input),
    mcpRequestApproval: (serverId: string) => void mcp.requestApproval(serverId),
    mcpWithdrawApproval: (serverId: string) => void mcp.withdrawApproval(serverId),
    deleteSkill: (name: string) => void mutations.deleteSkill(name),
    deleteAgent: (name: string) => void mutations.deleteAgent(name),
    removeServer: (serverId: string) => void mutations.mcpRemove(serverId),
  };
}

export type PluginItemActions = ReturnType<typeof usePluginItemActions>;
