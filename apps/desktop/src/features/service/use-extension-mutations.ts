import { useCallback, useState } from 'react';
import { showErrorToast } from '../../components/toast-store';
import type { ExtensionRoleTool } from './use-service';

function serviceApi() {
  if (!window.desktop?.service) throw new Error('Open the desktop app to manage the service.');
  return window.desktop.service;
}

/** Local skill update and role/MCP catalog writes; refresh is owned by the caller. */
export function useExtensionMutations() {
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const setSkillEnabled = useCallback(async (name: string, enabled: boolean) => {
    try {
      await serviceApi().setSkillEnabled(name, enabled);
    } catch (error) {
      showErrorToast(error);
      throw error;
    }
  }, []);

  const updateSkill = useCallback(async (name: string, refresh: () => Promise<void>) => {
    setBusyKey(`skill:${name}`);
    try {
      await serviceApi().updateSkill(name);
      await refresh();
    } catch (error) {
      showErrorToast(error);
    } finally {
      setBusyKey(null);
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
      setBusyKey(`role:${input.id}`);
      try {
        await serviceApi().putRole(input);
        await refresh();
        return true;
      } catch (error) {
        showErrorToast(error);
        return false;
      } finally {
        setBusyKey(null);
      }
    },
    [],
  );

  const installSkill = useCallback(
    async (
      input: { source: string; sourceKind: 'local' | 'npm' | 'git'; name?: string },
      refresh: () => Promise<void>,
    ) => {
      setBusyKey('skill:install');
      try {
        await serviceApi().installSkill(input);
        await refresh();
        return true;
      } catch (error) {
        showErrorToast(error);
        return false;
      } finally {
        setBusyKey(null);
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
      setBusyKey(`agent:${input.name}`);
      try {
        await serviceApi().putAgent(input);
        await refresh();
        return true;
      } catch (error) {
        showErrorToast(error);
        return false;
      } finally {
        setBusyKey(null);
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
      setBusyKey(`mcp:${input.serverId}`);
      try {
        await serviceApi().mcpUpsert(input);
        await refresh();
        return true;
      } catch (error) {
        showErrorToast(error);
        return false;
      } finally {
        setBusyKey(null);
      }
    },
    [],
  );

  const mcpDisable = useCallback(async (serverId: string, refresh: () => Promise<void>) => {
    setBusyKey(`mcp:${serverId}`);
    try {
      await serviceApi().mcpDisable(serverId);
      await refresh();
    } catch (error) {
      showErrorToast(error);
    } finally {
      setBusyKey(null);
    }
  }, []);

  const mcpRemove = useCallback(async (serverId: string, refresh: () => Promise<void>) => {
    setBusyKey(`mcp:${serverId}`);
    try {
      await serviceApi().mcpRemove(serverId);
      await refresh();
    } catch (error) {
      showErrorToast(error);
    } finally {
      setBusyKey(null);
    }
  }, []);

  return {
    busyKey,
    setSkillEnabled,
    updateSkill,
    installSkill,
    putRole,
    putAgent,
    mcpUpsert,
    mcpDisable,
    mcpRemove,
  };
}
