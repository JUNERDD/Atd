import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { TaskSearchHit, TaskSearchQuery } from '@atd/agent-contracts';
import type { AgentTask } from '../../client/agent/task-schema';
import { queryClient } from '../../lib/query-client';
import { agentApi } from './use-agent';

/** The pause in typing before a query goes out. */
const DEBOUNCE_MS = 200;
/** Cooldown before background task updates trigger a fresh search. */
const FRESHNESS_DEBOUNCE_MS = 1500;
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
 * Searches the history's conversations for `query` (already trimmed) once typing pauses. Background
 * task updates invalidate an active search after a cooldown without fragmenting the Query cache.
 * The previous answer stays while the next one loads, so rows do not drop out between keystrokes;
 * a refetch for the same query is not pending, which keeps the status line still while tasks run.
 * Failures show in place, never as a toast.
 */
export function useTaskContentSearch(
  query: string,
  tasks: AgentTask[],
  commands: NonNullable<TaskSearchQuery['commands']> = 'all',
  captures: NonNullable<TaskSearchQuery['captures']> = 'all',
): TaskContentSearch {
  const active = Array.from(query).length >= MIN_QUERY_LENGTH && tasks.length > 0;
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const freshness = active
    ? `${tasks.length}:${tasks.reduce((latest, task) => (task.updatedAt > latest ? task.updatedAt : latest), '')}`
    : '';
  const settled = debounced === query;
  const lastSearch = useRef<{ key: string; freshness: string } | null>(null);
  useEffect(() => {
    if (!active || !settled) {
      lastSearch.current = null;
      return;
    }
    const key = `${debounced}\0${commands}\0${captures}`;
    if (lastSearch.current?.key !== key) {
      lastSearch.current = { key, freshness };
      return;
    }
    if (lastSearch.current.freshness === freshness) return;
    const timer = setTimeout(() => {
      lastSearch.current = { key, freshness };
      void queryClient.invalidateQueries({
        queryKey: ['taskContentSearch', debounced, commands, captures],
        exact: true,
      });
    }, FRESHNESS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [active, settled, debounced, commands, captures, freshness]);
  const { data, isError } = useQuery(
    {
      queryKey: ['taskContentSearch', debounced, commands, captures],
      // The answer names its query and scope so a placeholder never reads as the new tab's answer.
      queryFn: async () => ({
        query: debounced,
        commands,
        captures,
        response: await agentApi().searchTasks({
          query: debounced,
          limit: HIT_LIMIT,
          commands,
          captures,
        }),
      }),
      enabled: active && settled,
      placeholderData: keepPreviousData,
      meta: { errorToast: false },
    },
    queryClient,
  );
  if (!active) return { hits: NO_HITS, pending: false, failed: false };
  const failed = settled && isError;
  const sameScope = data?.commands === commands && data?.captures === captures;
  return {
    hits: sameScope ? new Map(data.response.hits.map((hit) => [hit.taskId, hit])) : NO_HITS,
    pending: !failed && (!sameScope || data?.query !== query),
    failed,
  };
}
