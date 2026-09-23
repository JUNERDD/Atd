import { useEffect, useRef, useState } from 'react';
import type { ServiceBridge } from '../../../electron/service/ipc';
import {
  asAgentRow,
  asMcpRow,
  asSkillRow,
  useServiceStatus,
  type ExtensionAgentRow,
  type ExtensionMcpRow,
  type ExtensionSkillRow,
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

type Loaded<T> = { status: 'loading' } | { status: 'ready'; rows: T[] } | { status: 'failed' };

const loadSkills = (bridge: ServiceBridge) =>
  bridge.skills().then((result) => result.skills.flatMap((row) => asSkillRow(row) ?? []));
const loadAgents = (bridge: ServiceBridge) =>
  bridge.agents().then((result) => result.agents.flatMap((row) => asAgentRow(row) ?? []));
const loadMcp = (bridge: ServiceBridge) =>
  bridge.mcpStatus().then((result) => result.servers.flatMap((row) => asMcpRow(row) ?? []));

/**
 * Loads one list the first time its group is wanted while the service is connected. A failure
 * retries on the next opening; a reconnect may reach another service, so it also loads again.
 * Late replies from a superseded request are dropped.
 */
function useLazyList<T>(
  load: (bridge: ServiceBridge) => Promise<T[]>,
  wanted: boolean,
  connected: boolean,
): Loaded<T> | null {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
  const requested = useRef(false);
  const generation = useRef(0);
  useEffect(() => {
    if (!connected) {
      requested.current = false;
      generation.current += 1;
      return;
    }
    const bridge = window.desktop?.service;
    if (!bridge || !wanted || requested.current) return;
    requested.current = true;
    const request = ++generation.current;
    setLoaded({ status: 'loading' });
    load(bridge).then(
      (rows) => {
        if (request === generation.current) setLoaded({ status: 'ready', rows });
      },
      () => {
        if (request !== generation.current) return;
        requested.current = false;
        setLoaded({ status: 'failed' });
      },
    );
  }, [connected, wanted, load]);
  return loaded;
}

/**
 * Quiet counterparts of the Extensions lists for the quick panel (plan 1.10): nothing loads until
 * a group opens, and failures never toast. Without the desktop bridge (web preview, tests) every
 * list reports itself unavailable.
 */
export function useServiceLists(wanted: { skills: boolean; agents: boolean; mcp: boolean }): {
  skills: ServiceListView<ExtensionSkillRow>;
  agents: ServiceListView<ExtensionAgentRow>;
  mcp: ServiceListView<ExtensionMcpRow>;
} {
  const { status, loading } = useServiceStatus();
  const connected = status?.state === 'connected';
  const settling = loading || status?.state === 'connecting' || status?.state === 'reconnecting';
  const skills = useLazyList(loadSkills, wanted.skills, connected);
  const agents = useLazyList(loadAgents, wanted.agents, connected);
  const mcp = useLazyList(loadMcp, wanted.mcp, connected);
  function view<T>(loaded: Loaded<T> | null): ServiceListView<T> {
    if (!window.desktop?.service) return { status: 'unavailable' };
    if (connected) {
      if (!loaded) return { status: 'loading' };
      return loaded.status === 'failed' ? { status: 'unavailable' } : loaded;
    }
    return settling ? { status: 'loading' } : { status: 'unavailable' };
  }
  return { skills: view(skills), agents: view(agents), mcp: view(mcp) };
}
