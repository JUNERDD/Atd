import { queryOptions, useQuery } from '@tanstack/react-query';
import type { SettingsSnapshot } from '../../client/settings-contract';
import { bridgeKeys, guardedRead, pushSnapshot, wireSettingsBridge } from '../../lib/bridge-cache';
import { queryClient } from '../../lib/query-client';

function settingsSnapshotQuery() {
  const bridge = window.desktop?.settings;
  return queryOptions({
    queryKey: bridgeKeys.settings,
    queryFn: () => {
      if (!bridge) throw new Error('Open the desktop app to change settings.');
      wireSettingsBridge(bridge);
      return guardedRead(bridgeKeys.settings, () => bridge.get());
    },
    enabled: Boolean(bridge),
    // Broadcasts keep the snapshot current; a failure shows in place, with its retry.
    staleTime: Infinity,
    gcTime: Infinity,
    meta: { errorToast: false },
  });
}

/**
 * Shows a settings write's answer at once: the snapshot it returns is what main persisted, so the
 * next edit builds on it before the broadcast arrives.
 */
export function showSettingsSnapshot(snapshot: SettingsSnapshot) {
  pushSnapshot<SettingsSnapshot>(bridgeKeys.settings, () => snapshot);
}

/**
 * The settings snapshot: the initial read, then every broadcast change. `failed` reports a failed
 * read until a broadcast or a successful `retry` replaces it; the caller shows it where it
 * applies. A retry does not return to `loading`: pages that work without the snapshot stay as they
 * are, and `retrying` covers the read.
 */
export function useSettingsSnapshot() {
  const query = useQuery(settingsSnapshotQuery(), queryClient);
  const snapshot = query.data ?? null;
  const failed = !snapshot && query.errorUpdateCount > 0;
  const retrying = failed && query.isFetching;
  /** Reads the snapshot again after a failed read; a retry already running ignores the call. */
  const retry = () => {
    if (!retrying) void query.refetch();
  };
  return {
    snapshot,
    loading: query.isLoading && query.errorUpdateCount === 0,
    failed,
    retrying,
    retry,
  };
}
