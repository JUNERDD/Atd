import { queryOptions, useQuery, type QueryKey } from '@tanstack/react-query';
import type { PluginSummary } from '@atd/agent-contracts';
import type { ServiceBridge } from '../../client/service/ipc';
import { bridgeKeys, guardedRead, wireServiceBridge } from '../../lib/bridge-cache';
import { messageOf } from '../../lib/errors';
import { queryClient } from '../../lib/query-client';
import {
  asAgentDiagnostic,
  asAgentRow,
  asMcpRow,
  asRoleRow,
  asSkillRow,
  type ExtensionAgentRow,
  type ExtensionMcpRow,
  type ExtensionRoleRow,
  type ExtensionSkillRow,
} from './extension-rows';
import { asPluginSummary } from './plugin-rows';

/** MCP status rows and the one-time approval notice, as the status route answers them. */
export interface ServiceMcpState {
  servers: ExtensionMcpRow[];
  /** Launch approvals are new: servers configured before them need approving once. */
  approvalNotice: boolean;
}

export function asMcpState(result: { servers: unknown[]; approvalNotice: boolean }) {
  return {
    servers: result.servers.flatMap((row) => asMcpRow(row) ?? []),
    approvalNotice: result.approvalNotice,
  } satisfies ServiceMcpState;
}

/** Keys of the service's lists; all sit under `bridgeKeys.serviceLists`. */
export const serviceListKeys = {
  skills: [...bridgeKeys.serviceLists, 'skills'],
  agents: [...bridgeKeys.serviceLists, 'agents'],
  roles: [...bridgeKeys.serviceLists, 'roles'],
  mcp: [...bridgeKeys.serviceLists, 'mcp'],
  plugins: bridgeKeys.plugins,
  plugin: (id: string) => [...bridgeKeys.plugins, id],
} as const;

function serviceStatusQuery() {
  const bridge = window.desktop?.service;
  return queryOptions({
    queryKey: bridgeKeys.serviceStatus,
    queryFn: () => {
      if (!bridge) throw new Error('Open the desktop app to manage the service.');
      wireServiceBridge(bridge);
      return guardedRead(bridgeKeys.serviceStatus, () => bridge.status());
    },
    enabled: Boolean(bridge),
    // Status pushes keep it current.
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/**
 * Service connection status via the narrow service bridge (no token in the renderer), shared by
 * every caller in the window. `loading` covers the first read; a failed read shows its toast.
 */
export function useServiceStatus() {
  const { data, isLoading } = useQuery(serviceStatusQuery(), queryClient);
  return { status: data ?? null, loading: isLoading };
}

/**
 * One list the service answers while it is connected. Each read checks the rows against their
 * contract and leaves out the rows outside it, so one bad row cannot hide the rest. The lists
 * reload when anything invalidates them (`wireServiceBridge`, a write) and whenever a page that
 * shows them mounts or comes back into view, since the service changes some (MCP connection
 * states) without an event.
 */
export function serviceListQuery<T>(
  queryKey: QueryKey,
  read: (bridge: ServiceBridge) => Promise<T>,
  connected: boolean,
) {
  const bridge = window.desktop?.service;
  return queryOptions({
    queryKey,
    queryFn: () => {
      if (!bridge) throw new Error('Open the desktop app to manage the service.');
      wireServiceBridge(bridge);
      return read(bridge);
    },
    enabled: Boolean(bridge) && connected,
    // A section hidden in the settings window keeps its rows to show while they reload.
    gcTime: Infinity,
  });
}

/** The subagent catalog as Extensions shows it: its rows, and the ~/.atd/agents files it skipped. */
interface ServiceAgentCatalog {
  rows: ExtensionAgentRow[];
  diagnostics: PluginSummary['diagnostics'];
}

export const readSkills = (bridge: ServiceBridge) =>
  bridge.skills().then((result) => result.skills.flatMap((row) => asSkillRow(row) ?? []));
const readAgentCatalog = (bridge: ServiceBridge) =>
  bridge.agents().then((result): ServiceAgentCatalog => ({
    rows: result.agents.flatMap((row) => asAgentRow(row) ?? []),
    diagnostics: result.diagnostics.flatMap((value) => asAgentDiagnostic(value) ?? []),
  }));
export const readAgents = (bridge: ServiceBridge) =>
  readAgentCatalog(bridge).then((catalog) => catalog.rows);
const readRoles = (bridge: ServiceBridge) =>
  bridge.roles().then((result) => result.roles.flatMap((row) => asRoleRow(row) ?? []));
const readMcp = (bridge: ServiceBridge) => bridge.mcpStatus().then(asMcpState);
const readPlugins = (bridge: ServiceBridge) =>
  bridge.plugins().then((result) => result.plugins.flatMap((row) => asPluginSummary(row) ?? []));

/** Shows a switch change in a cached list before the service answers it. */
function patchList<T>(queryKey: QueryKey, update: (rows: T) => T) {
  queryClient.setQueryData<T>(queryKey, (current) => (current ? update(current) : current));
}

/** Skills list via the service bridge; null until the first read while connected. */
export function useServiceSkills() {
  const connected = useServiceStatus().status?.state === 'connected';
  const { data, isLoading } = useQuery(
    serviceListQuery(serviceListKeys.skills, readSkills, connected),
    queryClient,
  );
  return {
    skills: data ? { skills: data } : null,
    loading: isLoading,
    setEnabled: (name: string, enabled: boolean) =>
      patchList<ExtensionSkillRow[]>(serviceListKeys.skills, (rows) =>
        rows.map((row) => (row.name === name ? { ...row, enabled } : row)),
      ),
  };
}

/** Roles list via the service bridge. */
export function useServiceRoles() {
  const connected = useServiceStatus().status?.state === 'connected';
  const { data, isFetching } = useQuery(
    serviceListQuery(serviceListKeys.roles, readRoles, connected),
    queryClient,
  );
  return { roles: data ? { roles: data satisfies ExtensionRoleRow[] } : null, loading: isFetching };
}

/**
 * Markdown subagent catalog via the service bridge (`~/.atd/agents`), with the files that did not
 * load (`diagnostics`, empty until the first read), which Personal's page lists.
 */
export function useServiceAgents() {
  const connected = useServiceStatus().status?.state === 'connected';
  const { data, isFetching } = useQuery(
    serviceListQuery(serviceListKeys.agents, readAgentCatalog, connected),
    queryClient,
  );
  return {
    agents: data ? { agents: data.rows } : null,
    diagnostics: data?.diagnostics ?? [],
    loading: isFetching,
    setEnabled: (name: string, enabled: boolean) =>
      patchList<ServiceAgentCatalog>(serviceListKeys.agents, (catalog) => ({
        ...catalog,
        rows: catalog.rows.map((row) => (row.name === name ? { ...row, enabled } : row)),
      })),
  };
}

/** MCP status rows and the approval notice; a failed read shows its toast. */
export function useServiceMcpState() {
  const connected = useServiceStatus().status?.state === 'connected';
  const { data, isFetching } = useQuery(
    serviceListQuery(serviceListKeys.mcp, readMcp, connected),
    queryClient,
  );
  return {
    mcp: data ?? null,
    loading: isFetching,
    setEnabled: (serverId: string, enabled: boolean) =>
      patchList<ServiceMcpState>(serviceListKeys.mcp, (current) => ({
        ...current,
        servers: current.servers.map((row) =>
          row.serverId === serverId ? { ...row, disabled: !enabled } : row,
        ),
      })),
  };
}

/**
 * The plugin list via the service bridge: every host and installed plugin with its contents
 * counts. A failed read keeps the rows it had and reports `error` for the list to show beside
 * them, with `refresh` to read again; a later success clears it. Open plugin pages read their
 * detail again with every reload of the list (`usePluginDetail`).
 */
export function useServicePlugins() {
  const connected = useServiceStatus().status?.state === 'connected';
  const { data, error, isLoading, refetch } = useQuery(
    {
      ...serviceListQuery(serviceListKeys.plugins, readPlugins, connected),
      meta: { errorToast: false },
    },
    queryClient,
  );
  return {
    plugins: data ?? null,
    loading: isLoading,
    error: error ? messageOf(error) : null,
    refresh: () => void refetch(),
    setEnabled: (id: string, enabled: boolean) =>
      patchList<PluginSummary[]>(serviceListKeys.plugins, (rows) =>
        rows.map((row) => (row.id === id ? { ...row, enabled } : row)),
      ),
  };
}
