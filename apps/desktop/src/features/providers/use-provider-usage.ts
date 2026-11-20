import { useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CHATGPT_PRIVACY_VERSION } from '@atd/agent-contracts';
import { queryClient } from '../../lib/query-client';
import type { Connection, ProviderUsage } from '../../client/providers/schema';

/**
 * Whether an automatic usage read is allowed. A credential issue must not hit the keychain again
 * (macOS re-prompts on every failed read), and ChatGPT plan usage needs current privacy consent
 * and plan permission before its bearer token reaches the usage endpoint.
 */
export function providerUsageAvailable(connection: Connection | null): boolean {
  if (!connection?.connected || connection.credentialIssue) return false;
  if (connection.provider !== 'openai' || connection.authType !== 'oauth') return true;
  return (
    connection.chatgptConsent?.privacyVersion === CHATGPT_PRIVACY_VERSION &&
    connection.chatgptPlanEnabled === true
  );
}

/**
 * The provider-reported allowance for one connection. The service caches successful reads for
 * 30 seconds and the renderer shares one cache entry, so a settings row and its dialog make a
 * single request; providers without a usage API answer `unsupported` without failing the row.
 */
export function useProviderUsage(connection: Connection | null) {
  const bridge = window.desktop?.settings.providers;
  // A manual refresh must reach the provider, not the service's 30-second cache.
  const forceRefresh = useRef(false);
  const query = useQuery(
    {
      // A save increments the revision, so a replaced credential or changed configuration
      // fetches usage again instead of keeping the previous account's allowance.
      queryKey: ['providers', 'usage', connection?.connectionId, connection?.revision],
      queryFn: async (): Promise<ProviderUsage> => {
        if (!bridge || !connection) throw new Error('The provider bridge is unavailable.');
        const refresh = forceRefresh.current;
        forceRefresh.current = false;
        const usage = await bridge.usage(connection.connectionId, refresh);
        // A failed read keeps the previous snapshot in `data` and surfaces as a rejected refresh,
        // instead of replacing usable windows with the service's error payload.
        if (usage.kind === 'error') throw new Error(usage.message);
        return usage;
      },
      enabled: Boolean(bridge && providerUsageAvailable(connection)),
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      meta: { errorToast: false },
    },
    queryClient,
  );
  return {
    ...query,
    refresh: () => {
      forceRefresh.current = true;
      return query.refetch();
    },
  };
}
