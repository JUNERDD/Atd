import { QueryClient } from '@tanstack/react-query';

/**
 * The renderer's one TanStack Query cache. Hooks pass it to `useQuery` / `useQueries` explicitly,
 * so components that query render without a provider, in both windows and in tests.
 */
export const queryClient = new QueryClient();
