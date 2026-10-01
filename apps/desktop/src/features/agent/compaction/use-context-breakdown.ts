import { useQuery } from '@tanstack/react-query';
import type { ContextBreakdown, TaskContextState } from '@ai/agent-contracts';
import { messageOf } from '../../../lib/errors';
import { queryClient } from '../../../lib/query-client';
import { agentApi } from '../use-agent';

/**
 * The open task's context breakdown while the usage popover shows it. The service computes it on
 * each request, so it is fetched only while `open`; the key carries the ring's usage, window and
 * compaction count, so a finished turn or a compaction fetches a fresh one. The previous breakdown
 * stays on screen while the next one loads.
 */
export function useContextBreakdown(
  taskId: string,
  context: TaskContextState,
  open: boolean,
): { breakdown: ContextBreakdown | null; error: string } {
  const { data, error } = useQuery(
    {
      queryKey: [
        'contextBreakdown',
        taskId,
        context.tokens,
        context.compactions,
        context.contextWindow,
      ],
      queryFn: () => agentApi().contextBreakdown(taskId),
      enabled: open,
      // Only this task's previous breakdown stands in; another task's would mislead.
      placeholderData: (previous, previousQuery) =>
        previousQuery?.queryKey[1] === taskId ? previous : undefined,
      retry: false,
    },
    queryClient,
  );
  return { breakdown: data ?? null, error: error ? messageOf(error) : '' };
}
