import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { TaskSearchHit } from '@atd/agent-contracts';
import type { AgentTask } from '../../client/agent/task-schema';
import { queryClient } from '../../lib/query-client';
import { agentApi } from './use-agent';

/** The pause in typing before a query goes out. */
const DEBOUNCE_MS = 200;
/** Shorter queries match nearly every conversation, so only titles and statuses are searched. */
const MIN_QUERY_LENGTH = 2;
/** The service's own cap; the history lists every matching task it can. */
const HIT_LIMIT = 200;

export type TaskContentSearch = {
  /** Each matching task's best message, by task id; empty while the query is too short. */
  hits: ReadonlyMap<string, TaskSearchHit>;
  /** The current query's answer has not arrived yet: typing has not paused, or it is in flight. */
  pending: boolean;
  /** The current query's search failed; title and status matches still stand. */
  failed: boolean;
};

const NO_HITS: ReadonlyMap<string, TaskSearchHit> = new Map();

/**
 * Searches the history's conversations for `query` (already trimmed) once typing pauses. The key
 * carries a freshness token from the task list (the newest update and the count), so a finished
 * turn, a new task or a deletion searches again. The previous answer stays while the next one
 * loads, so rows do not drop out between keystrokes; a refetch for the same query is not pending,
 * which keeps the status line still while tasks run. Failures show in place, never as a toast.
 */
export function useTaskContentSearch(query: string, tasks: AgentTask[]): TaskContentSearch {
  const active = Array.from(query).length >= MIN_QUERY_LENGTH && tasks.length > 0;
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const newest = tasks.reduce(
    (latest, task) => (task.updatedAt > latest ? task.updatedAt : latest),
    '',
  );
  const settled = debounced === query;
  const { data, isError } = useQuery(
    {
      queryKey: ['taskContentSearch', debounced, newest, tasks.length],
      // The answer names its query, so a placeholder from an earlier one never reads as current.
      queryFn: async () => ({
        query: debounced,
        response: await agentApi().searchTasks({ query: debounced, limit: HIT_LIMIT }),
      }),
      enabled: active && settled,
      placeholderData: keepPreviousData,
      meta: { errorToast: false },
    },
    queryClient,
  );
  if (!active) return { hits: NO_HITS, pending: false, failed: false };
  const failed = settled && isError;
  return {
    hits: new Map(data?.response.hits.map((hit) => [hit.taskId, hit])),
    pending: !failed && data?.query !== query,
    failed,
  };
}
