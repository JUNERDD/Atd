import { useCallback } from 'react';
import type { SubagentPermissions } from '@ai/agent-contracts';
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
  const { mutations, mcp, skills, agents } = extensions;
  const { setAgentPermissions: savePermissions, restoreBuiltin: restore } = mutations;
  const { deleteSkill: removeSkillFiles, deleteAgent: removeAgentFile, mcpRemove } = mutations;
  const { refresh: refreshMcp, connect, authStart, authComplete } = mcp;
  const { requestApproval, withdrawApproval } = mcp;
  const { refresh: refreshSkills } = skills;
  const { refresh: refreshAgents } = agents;

  /** A command not yet in the agent snapshot opens the Commands list instead of its editor. */
  const openCommand = useCallback(
    (row: ExtensionCommandRow) => (row.id ? showCommand(row.id) : navigate('commands')),
    [navigate, showCommand],
  );
  const setAgentPermissions = useCallback(
    (name: string, permissions: SubagentPermissions | null) =>
      savePermissions(name, permissions, refreshAgents),
    [refreshAgents, savePermissions],
  );
  const restoreBuiltin = useCallback(
    (id: string) => restore(id, refreshSkills),
    [refreshSkills, restore],
  );
  const deleteSkill = useCallback(
    (name: string) => void removeSkillFiles(name, refreshSkills),
    [refreshSkills, removeSkillFiles],
  );
  const deleteAgent = useCallback(
    (name: string) => void removeAgentFile(name, refreshAgents),
    [refreshAgents, removeAgentFile],
  );
  const removeServer = useCallback(
    (serverId: string) => void mcpRemove(serverId, refreshMcp),
    [mcpRemove, refreshMcp],
  );
  return {
    openCommand,
    setItemEnabled: extensions.setItemEnabled,
    setServiceItemEnabled: extensions.setServiceItemEnabled,
    setAgentPermissions,
    restoreBuiltin,
    mcpConnect: (serverId: string) => void connect(serverId),
    mcpAuthStart: (serverId: string) => void authStart(serverId),
    mcpAuthComplete: (serverId: string, input: string) => void authComplete(serverId, input),
    mcpRequestApproval: (serverId: string) => void requestApproval(serverId),
    mcpWithdrawApproval: (serverId: string) => void withdrawApproval(serverId),
    deleteSkill,
    deleteAgent,
    removeServer,
  };
}

export type PluginItemActions = ReturnType<typeof usePluginItemActions>;
