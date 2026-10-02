import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { showErrorToast } from '../components/toast-store';

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: QueryErrorMeta;
    mutationMeta: QueryErrorMeta;
  }
}

/**
 * How a failure reports itself. A failed read or write shows its error toast unless its options
 * set `errorToast: false`, for one whose page shows the failure in place (an inline error, a
 * retry) or one that must stay quiet (the quick panel's lists).
 */
interface QueryErrorMeta extends Record<string, unknown> {
  errorToast?: false;
}

/**
 * The renderer's one TanStack Query cache. Hooks pass it to `useQuery` / `useMutation` explicitly,
 * so components that query render without a provider, in both windows and in tests.
 *
 * Reads and writes go over the native bridge, not the network: a failure is an answer, so nothing
 * retries on its own, and focusing a window never refetches (the bridges push their changes).
 */
export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.meta?.errorToast !== false) showErrorToast(error);
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.meta?.errorToast !== false) showErrorToast(error);
    },
  }),
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false },
    mutations: { retry: false },
  },
});

// A child transcript shows its failure in the drill-in view, which owns that query.
queryClient.setQueryDefaults(['childTranscript'], { meta: { errorToast: false } });
