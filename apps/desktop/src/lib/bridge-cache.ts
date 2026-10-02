import type { QueryKey } from '@tanstack/react-query';
import type {
  AgentBridge,
  AgentEvent,
  AgentSnapshot,
  MemorySnapshot,
} from '../client/agent/bridge';
import type { ServiceBridge, ServiceEvent, ServiceStatusView } from '../client/service/ipc';
import type { SettingsBridge, SettingsSnapshot } from '../client/settings-contract';
import { showErrorToast } from '../components/toast-store';
import { queryClient } from './query-client';

/**
 * Query keys of what the desktop bridges answer and push. Every list read from the service sits
 * under `serviceLists`, so one invalidation reloads them all; a plugin's detail sits under
 * `plugins`, so it reloads with the plugin list.
 */
export const bridgeKeys = {
  agentSnapshot: ['agent', 'snapshot'],
  memory: ['agent', 'memory'],
  settings: ['settings', 'snapshot'],
  serviceStatus: ['service', 'status'],
  serviceLists: ['service', 'lists'],
  plugins: ['service', 'lists', 'plugins'],
} as const satisfies Record<string, QueryKey>;

/** How many pushes each cached snapshot took, so a read can tell one landed while it ran. */
const pushes = new Map<string, number>();
const pushCount = (key: QueryKey) => pushes.get(JSON.stringify(key)) ?? 0;

/**
 * Applies a pushed value (a bridge event, or the snapshot a write answers) to a snapshot some page
 * of this window has read; one nothing has read yet is left to its first read.
 */
export function pushSnapshot<T>(key: QueryKey, update: (current: T | undefined) => T | undefined) {
  if (!queryClient.getQueryCache().find({ queryKey: key, exact: true })) return;
  pushes.set(JSON.stringify(key), pushCount(key) + 1);
  queryClient.setQueryData<T>(key, update);
}

/**
 * Reads a pushed snapshot. A push that lands while the read runs is the more recent state, so it
 * wins over the read's answer, and over its failure.
 */
export function guardedRead<T>(key: QueryKey, read: () => Promise<T>): Promise<T> {
  const seen = pushCount(key);
  const pushed = () => (pushCount(key) === seen ? undefined : queryClient.getQueryData<T>(key));
  return read().then(
    (value) => pushed() ?? value,
    (error: unknown) => {
      const current = pushed();
      if (current === undefined) throw error;
      return current;
    },
  );
}

/** The agent snapshot to keep: revisions only move forward, whichever of read and push is late. */
export function newerAgentSnapshot(current: AgentSnapshot | undefined, next: AgentSnapshot) {
  return !current || next.revision > current.revision ? next : current;
}

/** What makes plugin rows and details change when the command set does. */
const commandsKey = (snapshot: AgentSnapshot) =>
  snapshot.commands.map((item) => `${item.id}:${item.enabled}:${item.pluginId ?? ''}`).join('\n');

type BridgeName = 'agent' | 'settings' | 'service';
const wired = new Map<BridgeName, { bridge: object; dispose: () => void }>();

/**
 * Connects the cache to one bridge once, and again for a replaced bridge (tests install one per
 * case). Each query wires its bridge before its first read, so the pushes reach the cache whether
 * or not a page shows the data then: a page hidden in the settings window comes back current.
 */
function wireOnce(name: BridgeName, bridge: object, connect: () => () => void) {
  const current = wired.get(name);
  if (current?.bridge === bridge) return;
  current?.dispose();
  wired.set(name, { bridge, dispose: connect() });
}

const invalidate = (queryKey: QueryKey) => void queryClient.invalidateQueries({ queryKey });

/**
 * Agent pushes: snapshots (revisions only move forward) and memory. A changed snapshot error
 * shows its toast once per window; a changed command set or memory reloads the plugins, whose
 * counts and details list both.
 */
export function wireAgentBridge(bridge: AgentBridge) {
  wireOnce('agent', bridge, () => {
    let shown: AgentSnapshot | undefined;
    const stopSnapshots = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success') return;
      const [scope, name] = event.query.queryKey;
      if (scope !== bridgeKeys.agentSnapshot[0] || name !== bridgeKeys.agentSnapshot[1]) return;
      const next = queryClient.getQueryData<AgentSnapshot>(bridgeKeys.agentSnapshot);
      if (!next || next === shown) return;
      const previous = shown;
      shown = next;
      if (next.error && next.error !== previous?.error) showErrorToast(next.error);
      if (previous && commandsKey(previous) !== commandsKey(next)) invalidate(bridgeKeys.plugins);
    });
    const stopEvents = bridge.onChange((event: AgentEvent) => {
      if (event.type === 'snapshot')
        pushSnapshot<AgentSnapshot>(bridgeKeys.agentSnapshot, (current) =>
          newerAgentSnapshot(current, event.snapshot),
        );
      else if (event.type === 'memory') {
        pushSnapshot<MemorySnapshot>(bridgeKeys.memory, () => event.snapshot);
        invalidate(bridgeKeys.plugins);
      }
    });
    return () => {
      stopSnapshots();
      stopEvents();
    };
  });
}

/** Settings pushes: every broadcast replaces the snapshot. */
export function wireSettingsBridge(bridge: SettingsBridge) {
  wireOnce('settings', bridge, () =>
    bridge.onChange((snapshot) =>
      pushSnapshot<SettingsSnapshot>(bridgeKeys.settings, () => snapshot),
    ),
  );
}

/**
 * Service pushes: the connection status. The service's `extensions` event (another client may
 * have changed them) and a (re)connect, which may reach another service, reload every list.
 */
export function wireServiceBridge(bridge: ServiceBridge) {
  wireOnce('service', bridge, () =>
    bridge.onChange((event: ServiceEvent) => {
      if (event.type === 'status') {
        const before = queryClient.getQueryData<ServiceStatusView>(bridgeKeys.serviceStatus);
        pushSnapshot<ServiceStatusView>(bridgeKeys.serviceStatus, () => event.status);
        if (event.status.state === 'connected' && before?.state !== 'connected')
          invalidate(bridgeKeys.serviceLists);
      } else if (event.type === 'extensions') invalidate(bridgeKeys.serviceLists);
    }),
  );
}

// A hot-replaced module wires again, so the old listeners must not apply pushes twice.
import.meta.hot?.dispose(() => {
  wired.forEach((entry) => entry.dispose());
  wired.clear();
});
