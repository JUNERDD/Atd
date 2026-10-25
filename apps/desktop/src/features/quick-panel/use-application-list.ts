import { skipToken, useQuery } from '@tanstack/react-query';
import type { ApplicationReference } from '@atd/agent-contracts';
import { queryClient } from '../../lib/query-client';
import type { ServiceListView } from './use-service-lists';

type Application = Pick<ApplicationReference, 'bundleId' | 'name'>;

/** Installed-app metadata loads only for the open composer picker, without computer setup. */
export function useApplicationList(wanted: boolean): ServiceListView<Application> {
  const bridge = window.desktop?.computer;
  const { data, isError } = useQuery(
    {
      queryKey: ['computer', 'applications'],
      queryFn: wanted && bridge ? () => bridge.listApplications() : skipToken,
      retry: false,
      staleTime: 0,
      meta: { errorToast: false },
    },
    queryClient,
  );
  if (!bridge) return { status: 'unavailable' };
  if (data) return { status: 'ready', rows: data };
  return isError ? { status: 'unavailable' } : { status: 'loading' };
}
