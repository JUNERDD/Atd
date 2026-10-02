import { useQuery, type QueryKey, type UseQueryResult } from '@tanstack/react-query';
import type { ServiceBridge } from '../../client/service/ipc';
import { queryClient } from '../../lib/query-client';
import {
  asMcpRow,
  type ExtensionAgentRow,
  type ExtensionMcpRow,
  type ExtensionSkillRow,
} from '../service/extension-rows';
import {
  readAgents,
  readSkills,
  serviceListKeys,
  serviceListQuery,
  useServiceStatus,
} from '../service/use-service';

/**
 * A service-backed list as a quick-panel view sees it. Only rows are shown: a list that is still
 * loading only keeps the panel from reporting no match, and one that is unavailable (no desktop
 * bridge, a disconnected service with its own banner, a failed load) is simply left out.
 */
export type ServiceListView<T> =
  | { status: 'ready'; rows: T[] }
  | { status: 'loading' }
  | { status: 'unavailable' };

const readMcp = (bridge: ServiceBridge) =>
  bridge.mcpStatus().then((result) => result.servers.flatMap((row) => asMcpRow(row) ?? []));

/**
 * One list the first time its group is wanted while the service is connected, under its own key
 * beside the Extensions section's (quiet: a failure never toasts, and the list just leaves its
 * group out). A failure reads again on the next opening; the bridge cache reloads the list after
 * a reconnect, which may reach another service, and after another client changed the extensions.
 */
function useQuietList<T>(
  key: QueryKey,
  read: (bridge: ServiceBridge) => Promise<T[]>,
  wanted: boolean,
  connected: boolean,
) {
  // The query runs only while the group is wanted as well as connected.
  const query = serviceListQuery([...key, 'quiet'], read, connected && wanted);
  return useQuery(
    {
      ...query,
      staleTime: Infinity,
      meta: { errorToast: false },
    },
    queryClient,
  );
}

/**
 * Quiet counterparts of the Extensions lists for the quick panel (plan 1.10): nothing loads until
 * a group opens, and failures never toast. Without the desktop bridge (tests) every list reports
 * itself unavailable.
 */
export function useServiceLists(wanted: { skills: boolean; agents: boolean; mcp: boolean }): {
  skills: ServiceListView<ExtensionSkillRow>;
  agents: ServiceListView<ExtensionAgentRow>;
  mcp: ServiceListView<ExtensionMcpRow>;
} {
  const { status, loading } = useServiceStatus();
  const connected = status?.state === 'connected';
  const settling = loading || status?.state === 'connecting' || status?.state === 'reconnecting';
  const skills = useQuietList(serviceListKeys.skills, readSkills, wanted.skills, connected);
  const agents = useQuietList(serviceListKeys.agents, readAgents, wanted.agents, connected);
  const mcp = useQuietList(serviceListKeys.mcp, readMcp, wanted.mcp, connected);
  function view<T>(list: UseQueryResult<T[]>): ServiceListView<T> {
    if (!window.desktop?.service) return { status: 'unavailable' };
    if (connected) {
      if (list.data) return { status: 'ready', rows: list.data };
      return list.isError ? { status: 'unavailable' } : { status: 'loading' };
    }
    return settling ? { status: 'loading' } : { status: 'unavailable' };
  }
  return { skills: view(skills), agents: view(agents), mcp: view(mcp) };
}
