import { useQuery } from '@tanstack/react-query';
import type { AppCapabilityConsent } from '@atd/agent-contracts';
import type { AppsBridge } from '../../client/apps-contract';
import { messageOf } from '../../lib/errors';
import { queryClient } from '../../lib/query-client';
import { useServiceStatus } from '../service/use-service';

/** Query keys of the apps data; everything sits under `all`, so one invalidation reloads it. */
export const appKeys = {
  all: ['apps'],
  list: ['apps', 'list'],
  detail: (appId: string) => ['apps', 'detail', appId],
  versions: (appId: string) => ['apps', 'versions', appId],
} as const;

let wired: { bridge: AppsBridge; stop: () => void } | null = null;

/**
 * The apps bridge, with the cache following its changes: an `apps` invalidation or a reconnect
 * reloads every app query of this window, whichever page shows it. Wired once per bridge (tests
 * install one per case).
 */
export function appsBridge(): AppsBridge {
  const bridge = window.desktop?.apps;
  if (!bridge) throw new Error('Open the desktop app to use apps.');
  if (wired?.bridge !== bridge) {
    wired?.stop();
    wired = {
      bridge,
      stop: bridge.onChange(() => void queryClient.invalidateQueries({ queryKey: appKeys.all })),
    };
  }
  return bridge;
}

// A hot-replaced module wires again, so the old listener must not invalidate twice.
import.meta.hot?.dispose(() => {
  wired?.stop();
  wired = null;
});

/** Reads app data while the service is connected; failures show in place, not as toasts. */
function useAppsQuery<T>(queryKey: readonly unknown[], read: (bridge: AppsBridge) => Promise<T>) {
  const connected = useServiceStatus().status?.state === 'connected';
  return useQuery(
    {
      queryKey,
      queryFn: () => read(appsBridge()),
      enabled: Boolean(window.desktop?.apps) && connected,
      gcTime: Infinity,
      meta: { errorToast: false },
    },
    queryClient,
  );
}

/**
 * Every app, most recently updated first, and the capability consents waiting on them (oldest
 * first across apps). `apps` is null until the first read answers.
 */
export function useApps() {
  const { data, error, isLoading, refetch } = useAppsQuery(appKeys.list, (bridge) => bridge.list());
  const consents: AppCapabilityConsent[] = (data?.apps ?? [])
    .flatMap((app) => app.consents)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    apps: data?.apps ?? null,
    consents,
    loading: isLoading,
    error: error ? messageOf(error) : null,
    retry: () => void refetch(),
  };
}

/** One app's details (grants, capabilities, source task); null until read. */
export function useAppDetail(appId: string) {
  const { data, error, refetch } = useAppsQuery(appKeys.detail(appId), (bridge) =>
    bridge.get(appId),
  );
  return {
    detail: data ?? null,
    error: error ? messageOf(error) : null,
    retry: () => void refetch(),
  };
}

/** One app's kept versions, newest first; null until read. */
export function useAppVersions(appId: string) {
  const { data, error, refetch } = useAppsQuery(appKeys.versions(appId), (bridge) =>
    bridge.versions(appId),
  );
  return {
    versions: data ?? null,
    error: error ? messageOf(error) : null,
    retry: () => void refetch(),
  };
}
