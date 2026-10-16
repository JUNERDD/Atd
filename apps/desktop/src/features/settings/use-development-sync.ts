import { useMutation } from '@tanstack/react-query';
import { queryClient } from '../../lib/query-client';

/** The service publishes the imported settings/commands/extensions to both windows. */
export function useDevelopmentSync() {
  return useMutation(
    {
      mutationFn: () => {
        const bridge = window.desktop?.service;
        if (!bridge) throw new Error('Open the development app to sync its configuration.');
        return bridge.syncDevelopment();
      },
      retry: false,
      meta: { errorToast: false },
    },
    queryClient,
  );
}
