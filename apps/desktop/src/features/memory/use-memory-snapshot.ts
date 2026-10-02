import { queryOptions, useQuery } from '@tanstack/react-query';
import type { MemorySnapshot } from '../../client/agent/bridge';
import { bridgeKeys, guardedRead, pushSnapshot, wireAgentBridge } from '../../lib/bridge-cache';
import { queryClient } from '../../lib/query-client';

function memoryQuery(enabled: boolean) {
  const bridge = window.desktop?.agent;
  return queryOptions({
    queryKey: bridgeKeys.memory,
    queryFn: () => {
      if (!bridge) throw new Error('Open the desktop app to manage memory.');
      wireAgentBridge(bridge);
      return guardedRead(bridgeKeys.memory, () => bridge.memory());
    },
    enabled: enabled && Boolean(bridge),
    // The bridge's `memory` events keep it current, also while no page shows it.
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/** Reads the memories again, as the Memory section's Reload does after a failed read. */
export function reloadMemory() {
  void queryClient.refetchQueries({ queryKey: bridgeKeys.memory, exact: true });
}

/** Shows the snapshot a memory write answers, before its change event arrives. */
export function showMemorySnapshot(snapshot: MemorySnapshot) {
  pushSnapshot<MemorySnapshot>(bridgeKeys.memory, () => snapshot);
}

/**
 * Saved memories as the agent bridge reports them, kept current by its `memory` change events, so
 * every page that shows memory (the Memory section, Personal's Memory tab, the `@` panel) reads one
 * source. Null until the first read answers, or while `enabled` is false; a failed read shows its
 * error toast and sets `failed` until a read answers.
 */
export function useMemorySnapshot(enabled = true) {
  const { data, isError } = useQuery(memoryQuery(enabled), queryClient);
  return { snapshot: enabled ? (data ?? null) : null, failed: enabled && !data && isError };
}
