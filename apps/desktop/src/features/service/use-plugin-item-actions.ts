import { useCallback } from 'react';
import type { PluginDetail, SubagentPermissions } from '@ai/agent-contracts';
import { useOpenSettingsCommand, useSettingsNavigation } from '../settings/settings-navigation';
import type { ExtensionCommandRow } from './extension-commands';
import type { Extensions } from './use-extensions';

/**
 * What a plugin's item rows do, shared by plugin pages and search results: switches (routed by
 * `useExtensions` to the store that keeps them), subagent permissions, built-in restore, MCP
 * connection steps, Allow to run, and commands, which open in the Commands section.
 */
export function usePluginItemActions(extensions: Extensions) {
  const navigate = useSettingsNavigation();
  const showCommand = useOpenSettingsCommand();
  const { mutations, pluginMutations, mcp, skills, agents } = extensions;
  const { setAgentPermissions: savePermissions, restoreBuiltin: restore, mcpRemove } = mutations;
  const { setApproval } = pluginMutations;
  const { refresh: refreshMcp, connect, authStart, authComplete } = mcp;
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
  const removeServer = useCallback(
    (serverId: string) => void mcpRemove(serverId, refreshMcp),
    [mcpRemove, refreshMcp],
  );
  /** `name` is the server's name inside the plugin; answers the plugin's new detail. */
  const approve = useCallback(
    async (pluginId: string, name: string): Promise<PluginDetail | null> => {
      const result = await setApproval({ id: pluginId, name, approved: true });
      if (!result.ok) return null;
      void refreshMcp();
      return result.value;
    },
    [refreshMcp, setApproval],
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
    removeServer,
    approve,
  };
}

export type PluginItemActions = ReturnType<typeof usePluginItemActions>;
