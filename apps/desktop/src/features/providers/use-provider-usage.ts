import { useQuery } from '@tanstack/react-query';
import { queryClient } from '../../lib/query-client';
import type { Connection, ProviderUsage } from '../../client/providers/schema';

/**
 * The provider-reported allowance for one connection. The service caches successful reads for
 * 30 seconds and the renderer shares one cache entry, so a settings row and its dialog make a
 * single request; providers without a usage API answer `unsupported` without failing the row.
 */
export function useProviderUsage(connection: Connection | null) {
  const bridge = window.desktop?.settings.providers;
  return useQuery(
    {
      // A save increments the revision, so a replaced credential or changed configuration
      // fetches usage again instead of keeping the previous account's allowance.
      queryKey: ['providers', 'usage', connection?.connectionId, connection?.revision],
      queryFn: (): Promise<ProviderUsage> => {
        if (!bridge || !connection)
          return Promise.reject(new Error('The provider bridge is unavailable.'));
        return bridge.usage(connection.connectionId);
      },
      enabled: Boolean(bridge && connection?.connected),
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      meta: { errorToast: false },
    },
    queryClient,
  );
}
