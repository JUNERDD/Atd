import { useCallback, useEffect, useRef, useState } from 'react';
import type { ServiceStatusView } from '../../../electron/service/ipc';
import { showErrorToast } from '../../components/toast-store';

function serviceApi() {
  if (!window.desktop?.service) throw new Error('Open the desktop app to manage the service.');
  return window.desktop.service;
}

/** Service connection status via the narrow preload bridge (no token in renderer). */
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

export type ExtensionRoleTool = 'read' | 'write' | 'edit' | 'bash' | 'command';

/** Install state of a resource that ships with the app; `modified` copies are never overwritten. */
export interface ExtensionBuiltin {
  id: string;
  status: 'current' | 'modified' | 'update_available';
}

export interface ExtensionSkillRow {
  name: string;
  description: string;
  sourceKind: 'local' | 'npm' | 'git' | 'agents' | 'atd' | '';
  /** Seeded by the service; the row reads as a system skill instead of its folder. */
  system: boolean;
  /** Null for skills that do not ship with the app. */
  builtin: ExtensionBuiltin | null;
  revision: string;
  enabled: boolean;
}

export interface ExtensionRoleRow {
  id: string;
  title: string;
  allows: { tools: ExtensionRoleTool[]; skills: string[] };
}

export interface ExtensionAgentRow {
  name: string;
  /** Registered by the service for every session; read-only. */
  system: boolean;
  description: string;
  tools: ExtensionRoleTool[];
  model: string;
  systemPrompt: string;
}

export interface ExtensionMcpRow {
  serverId: string;
  state: string;
  lastError: string;
}

export const ROLE_TOOLS: ExtensionRoleTool[] = ['read', 'write', 'edit', 'bash', 'command'];

function readString(value: unknown, key: string): string {
  if (typeof value !== 'object' || value === null) return '';
  const field = Reflect.get(value, key);
  return typeof field === 'string' ? field : '';
}

function readFlag(value: unknown, key: string): boolean {
  if (typeof value !== 'object' || value === null) return false;
  return Reflect.get(value, key) === true;
}

function readEnabled(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true;
  const field = Reflect.get(value, 'enabled');
  return typeof field === 'boolean' ? field : true;
}

function asSourceKind(value: string): ExtensionSkillRow['sourceKind'] {
  if (value === 'local' || value === 'npm' || value === 'git') return value;
  if (value === 'agents' || value === 'atd') return value;
  return '';
}

function asBuiltin(value: unknown): ExtensionBuiltin | null {
  if (typeof value !== 'object' || value === null) return null;
  const builtin = Reflect.get(value, 'builtin');
  const id = readString(builtin, 'id');
  const status = readString(builtin, 'status');
  if (!id) return null;
  if (status === 'current' || status === 'modified' || status === 'update_available')
    return { id, status };
  return null;
}

function asRoleTool(value: unknown): ExtensionRoleTool | null {
  if (value === 'read' || value === 'write' || value === 'edit') return value;
  if (value === 'bash' || value === 'command') return value;
  return null;
}

function asAllows(value: unknown): ExtensionRoleRow['allows'] {
  if (typeof value !== 'object' || value === null) return { tools: [], skills: [] };
  const toolsRaw = Reflect.get(value, 'tools');
  const skillsRaw = Reflect.get(value, 'skills');
  const tools = Array.isArray(toolsRaw)
    ? toolsRaw.flatMap((tool) => {
        const parsed = asRoleTool(tool);
        return parsed ? [parsed] : [];
      })
    : [];
  const skills = Array.isArray(skillsRaw)
    ? skillsRaw.filter((skill): skill is string => typeof skill === 'string')
    : [];
  return { tools, skills };
}

export function asSkillRow(value: unknown): ExtensionSkillRow | null {
  const name = readString(value, 'name');
  return name
    ? {
        name,
        description: readString(value, 'description'),
        sourceKind: asSourceKind(readString(value, 'sourceKind')),
        system: readFlag(value, 'system'),
        builtin: asBuiltin(value),
        revision: readString(value, 'revision'),
        enabled: readEnabled(value),
      }
    : null;
}

function asRoleRow(value: unknown): ExtensionRoleRow | null {
  const id = readString(value, 'id');
  if (!id) return null;
  const allows =
    typeof value === 'object' && value !== null ? Reflect.get(value, 'allows') : undefined;
  return { id, title: readString(value, 'title') || id, allows: asAllows(allows) };
}

function asAgentTools(value: unknown): ExtensionRoleTool[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((tool) => {
    const parsed = asRoleTool(tool);
    return parsed ? [parsed] : [];
  });
}

export function asAgentRow(value: unknown): ExtensionAgentRow | null {
  const name = readString(value, 'name');
  if (!name) return null;
  const tools =
    typeof value === 'object' && value !== null ? Reflect.get(value, 'tools') : undefined;
  const model = readString(value, 'model');
  return {
    name,
    system: readFlag(value, 'system'),
    description: readString(value, 'description'),
    tools: asAgentTools(tools),
    model,
    systemPrompt: readString(value, 'systemPrompt'),
  };
}

export function asMcpRow(value: unknown): ExtensionMcpRow | null {
  const serverId = readString(value, 'serverId');
  return serverId
    ? { serverId, state: readString(value, 'state'), lastError: readString(value, 'lastError') }
    : null;
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
  return { agents, loading, refresh };
}

/** MCP status via the service bridge. */
export function useServiceMcp() {
  const [mcp, setMcp] = useState<{ servers: ExtensionMcpRow[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!window.desktop?.service) return;
    setLoading(true);
    try {
      const result = await window.desktop.service.mcpStatus();
      setMcp({ servers: result.servers.flatMap((row) => asMcpRow(row) ?? []) });
    } catch (error) {
      showErrorToast(error);
    } finally {
      setLoading(false);
    }
  }, []);
  const connect = useCallback(
    async (serverId: string) => {
      setBusyId(serverId);
      try {
        await serviceApi().mcpConnect(serverId);
        await refresh();
      } catch (error) {
        showErrorToast(error);
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );
  const authStart = useCallback(async (serverId: string) => {
    setBusyId(serverId);
    try {
      await serviceApi().mcpAuthStart(serverId);
    } catch (error) {
      showErrorToast(error);
    } finally {
      setBusyId(null);
    }
  }, []);
  const authComplete = useCallback(
    async (serverId: string, input: string) => {
      setBusyId(serverId);
      try {
        await serviceApi().mcpAuthComplete(serverId, input);
        await refresh();
      } catch (error) {
        showErrorToast(error);
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );
  return { mcp, loading, busyId, refresh, connect, authStart, authComplete };
}
