import { useCallback, useState } from 'react';
import type { SubagentPermissions } from '@ai/agent-contracts';
import { showErrorToast } from '../../components/toast-store';
import type { ExtensionRoleTool } from './extension-rows';

function serviceApi() {
  if (!window.desktop?.service) throw new Error('Open the desktop app to manage the service.');
  return window.desktop.service;
}

/**
 * What a write in progress holds: one built-in, role, subagent or MCP server, one plugin, or an
 * install. Rows lock while their own target is busy; pages lock while anything is.
 */
export type ExtensionBusyTarget =
  | { kind: 'builtin' | 'role' | 'agent' | 'mcp'; name: string }
  | { kind: 'plugin'; id: string }
  | { kind: 'install' };

/** Skill, subagent and MCP catalog writes; refresh is owned by the caller. */
export function useExtensionMutations() {
  const [busy, setBusy] = useState<ExtensionBusyTarget | null>(null);

  const setSkillEnabled = useCallback(async (name: string, enabled: boolean) => {
    try {
      await serviceApi().setSkillEnabled(name, enabled);
    } catch (error) {
      showErrorToast(error);
      throw error;
    }
  }, []);

  const setAgentEnabled = useCallback(async (name: string, enabled: boolean) => {
    try {
      await serviceApi().setAgentEnabled(name, enabled);
    } catch (error) {
      showErrorToast(error);
      throw error;
    }
  }, []);

  /**
   * Reinstalls the shipped version of a built-in resource after the service backs up the user's
   * copy; the builtin id (`skill:<name>` for skill rows) is busy meanwhile. Resolves to the
   * backup path (null when there was nothing to back up), or undefined when the restore failed.
   */
  const restoreBuiltin = useCallback(async (id: string, refresh: () => Promise<void>) => {
    setBusy({ kind: 'builtin', name: id });
    try {
      const result = await serviceApi().restoreBuiltin(id);
      await refresh();
      return { backupPath: result.backupPath };
    } catch {
      return undefined;
    } finally {
      setBusy(null);
    }
  }, []);

  const putRole = useCallback(
    async (
      input: {
        id: string;
        title: string;
        allows: { tools: ExtensionRoleTool[]; skills: string[] };
      },
      refresh: () => Promise<void>,
    ) => {
      setBusy({ kind: 'role', name: input.id });
      try {
        await serviceApi().putRole(input);
        await refresh();
        return true;
      } catch (error) {
        showErrorToast(error);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const putAgent = useCallback(
    async (
      input: {
        name: string;
        description: string;
        tools: ExtensionRoleTool[];
        model: string | null;
        systemPrompt: string;
      },
      refresh: () => Promise<void>,
    ) => {
      setBusy({ kind: 'agent', name: input.name });
      try {
        await serviceApi().putAgent(input);
        await refresh();
        return true;
      } catch (error) {
        showErrorToast(error);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  /** Saves one subagent's permissions for later runs, or with null restores its defaults. */
  const setAgentPermissions = useCallback(
    async (name: string, permissions: SubagentPermissions | null, refresh: () => Promise<void>) => {
      setBusy({ kind: 'agent', name });
      try {
        await serviceApi().setAgentPermissions(name, permissions);
        await refresh();
        return true;
      } catch (error) {
        showErrorToast(error);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const mcpUpsert = useCallback(
    async (
      input: {
        serverId: string;
        transport: 'stdio' | 'streamable-http' | 'sse';
        command?: string;
        args?: string[];
        url?: string;
        auth: { type: 'none' } | { type: 'bearer'; tokenEnv: string } | { type: 'oauth' };
      },
      refresh: () => Promise<void>,
    ) => {
      setBusy({ kind: 'mcp', name: input.serverId });
      try {
        await serviceApi().mcpUpsert(input);
        await refresh();
        return true;
      } catch (error) {
        showErrorToast(error);
        return false;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  /** Turns a Personal server on or off; rejects after showing the error, so a switch can revert. */
  const mcpSetEnabled = useCallback(
    async (serverId: string, enabled: boolean, refresh: () => Promise<void>) => {
      setBusy({ kind: 'mcp', name: serverId });
      try {
        await serviceApi().mcpSetEnabled(serverId, enabled);
        await refresh();
      } catch (error) {
        showErrorToast(error);
        throw error;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const mcpRemove = useCallback(async (serverId: string, refresh: () => Promise<void>) => {
    setBusy({ kind: 'mcp', name: serverId });
    try {
      await serviceApi().mcpRemove(serverId);
      await refresh();
    } catch (error) {
      showErrorToast(error);
    } finally {
      setBusy(null);
    }
  }, []);

  return {
    busy,
    setSkillEnabled,
    setAgentEnabled,
    restoreBuiltin,
    putRole,
    putAgent,
    setAgentPermissions,
    mcpUpsert,
    mcpSetEnabled,
    mcpRemove,
  };
}
