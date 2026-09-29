import { useCallback, useEffect, useRef, useState } from 'react';
import type { PluginSummary } from '@ai/agent-contracts';
import type { ServiceStatusView } from '../../client/service/ipc';
import { showErrorToast } from '../../components/toast-store';
import {
  asAgentRow,
  asRoleRow,
  asSkillRow,
  type ExtensionAgentRow,
  type ExtensionRoleRow,
  type ExtensionSkillRow,
} from './extension-rows';
import { asPluginSummary } from './plugin-rows';

function serviceApi() {
  if (!window.desktop?.service) throw new Error('Open the desktop app to manage the service.');
  return window.desktop.service;
}

/** Service connection status via the narrow service bridge (no token in the renderer). */
export function useServiceStatus() {
  const [status, setStatus] = useState<ServiceStatusView | null>(null);
  const [loading, setLoading] = useState(() => Boolean(window.desktop?.service));
  useEffect(() => {
    const bridge = window.desktop?.service;
    if (!bridge) return;
    let active = true;
    void bridge.status().then(
      (value) => {
        if (active) {
          setStatus(value);
          setLoading(false);
        }
      },
      (error) => {
        if (active) {
          showErrorToast(error);
          setLoading(false);
        }
      },
    );
    return bridge.onChange((event) => {
      if (event.type === 'status' && active) setStatus(event.status);
    });
  }, []);
  const connect = useCallback(async (dataDir: string) => {
    setStatus(await serviceApi().connect(dataDir));
  }, []);
  const disconnect = useCallback(async () => {
    setStatus(await serviceApi().disconnect());
  }, []);
  const startLocal = useCallback(async (dataDir: string) => {
    setStatus(await serviceApi().startLocal(dataDir));
  }, []);
  return { status, loading, connect, disconnect, startLocal };
}

/** Skills list via the service bridge; empty when disconnected. */
export function useServiceSkills() {
  const [skills, setSkills] = useState<{ skills: ExtensionSkillRow[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const loaded = useRef(false);
  const refresh = useCallback(async () => {
    if (!window.desktop?.service) return;
    if (!loaded.current) setLoading(true);
    try {
      const result = await window.desktop.service.skills();
      loaded.current = true;
      setSkills({ skills: result.skills.flatMap((row) => asSkillRow(row) ?? []) });
    } catch (error) {
      showErrorToast(error);
    } finally {
      setLoading(false);
    }
  }, []);
  const setEnabled = useCallback((name: string, enabled: boolean) => {
    setSkills((current) =>
      current
        ? {
            skills: current.skills.map((row) => (row.name === name ? { ...row, enabled } : row)),
          }
        : current,
    );
  }, []);
  return { skills, loading, refresh, setEnabled };
}

/** Roles list via the service bridge. */
export function useServiceRoles() {
  const [roles, setRoles] = useState<{ roles: ExtensionRoleRow[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    if (!window.desktop?.service) return;
    setLoading(true);
    try {
      const result = await window.desktop.service.roles();
      setRoles({ roles: result.roles.flatMap((row) => asRoleRow(row) ?? []) });
    } catch (error) {
      showErrorToast(error);
    } finally {
      setLoading(false);
    }
  }, []);
  return { roles, loading, refresh };
}

/** Markdown subagent catalog via the service bridge (`~/.atd/agents`). */
export function useServiceAgents() {
  const [agents, setAgents] = useState<{ agents: ExtensionAgentRow[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    if (!window.desktop?.service) return;
    setLoading(true);
    try {
      const result = await window.desktop.service.agents();
      setAgents({ agents: result.agents.flatMap((row) => asAgentRow(row) ?? []) });
    } catch (error) {
      showErrorToast(error);
    } finally {
      setLoading(false);
    }
  }, []);
  const setEnabled = useCallback((name: string, enabled: boolean) => {
    setAgents((current) =>
      current
        ? { agents: current.agents.map((row) => (row.name === name ? { ...row, enabled } : row)) }
        : current,
    );
  }, []);
  return { agents, loading, refresh, setEnabled };
}

/**
 * The plugin list via the service bridge: every host and installed plugin with its contents
 * counts. Rows outside the contract are left out, so one bad row cannot hide the rest. `epoch`
 * moves after every reload, so an open plugin page reads its detail again with the list.
 */
export function useServicePlugins() {
  const [plugins, setPlugins] = useState<PluginSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const loaded = useRef(false);
  const refresh = useCallback(async () => {
    if (!window.desktop?.service) return;
    if (!loaded.current) setLoading(true);
    try {
      const result = await window.desktop.service.plugins();
      loaded.current = true;
      setPlugins(result.plugins.flatMap((row) => asPluginSummary(row) ?? []));
    } catch (error) {
      showErrorToast(error);
    } finally {
      setLoading(false);
      setEpoch((value) => value + 1);
    }
  }, []);
  const setEnabled = useCallback((id: string, enabled: boolean) => {
    setPlugins((current) =>
      current ? current.map((row) => (row.id === id ? { ...row, enabled } : row)) : current,
    );
  }, []);
  return { plugins, loading, epoch, refresh, setEnabled };
}
