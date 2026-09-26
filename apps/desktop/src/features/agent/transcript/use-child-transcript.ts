import { useQueries, useQuery } from '@tanstack/react-query';
import type { AgentBridge, ChildTranscriptDetail } from '../../../../electron/agent/bridge';
import { applyTranscriptPatch } from '../../../../electron/agent/transcript-schema';
import { messageOf } from '../../../lib/errors';
import { queryClient } from '../../../lib/query-client';

/**
 * How long a child's transcript stays cached, and subscribed, after nothing shows or prefetches
 * it: the step from the subagent list to the drill-in view and a later return both find it.
 */
const LINGER_MS = 5 * 60_000;

const SCOPE = 'childTranscript';
const queryKey = (taskId: string, childKey: string) => [SCOPE, taskId, childKey] as const;

/**
 * Main-process holds per cached child. Every `childTranscript` call subscribes and adds one hold,
 * even a call that fails, and main handles calls in send order; all of a child's holds are
 * released together when Query drops its cache entry.
 */
const holds = new Map<string, number>();
const holdKey = (taskId: string, childKey: string) => `${taskId}\n${childKey}`;

let wired = false;

/**
 * Connects the cache to the bridge once: releases a child's holds when its entry is removed, and
 * applies `childTranscript` patches to cached transcripts like the parent's. A patch landing while
 * a fetch is in flight is covered by that fetch, whose state is at least as new; a revision gap
 * fetches a fresh state.
 */
function wire(bridge: AgentBridge) {
  if (wired) return;
  wired = true;
  const stopRemovals = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'removed') return;
    const [scope, taskId, childKey] = event.query.queryKey;
    if (scope !== SCOPE || typeof taskId !== 'string' || typeof childKey !== 'string') return;
    const key = holdKey(taskId, childKey);
    const count = holds.get(key) ?? 0;
    holds.delete(key);
    for (let index = 0; index < count; index += 1)
      void bridge.releaseChildTranscript(taskId, childKey).catch(() => {});
  });
  const stopPatches = bridge.onChange((event) => {
    if (event.type !== 'childTranscript') return;
    const { patch } = event;
    const key = queryKey(patch.taskId, patch.childKey);
    const query = queryClient.getQueryCache().find<ChildTranscriptDetail>({ queryKey: key });
    if (!query || query.state.fetchStatus === 'fetching') return;
    const current = query.state.data;
    const patched = current
      ? applyTranscriptPatch({ revision: current.revision, blocks: current.blocks }, patch)
      : null;
    if (!current || !patched) {
      void queryClient.refetchQueries({ queryKey: key, exact: true });
      return;
    }
    queryClient.setQueryData<ChildTranscriptDetail>(key, {
      ...current,
      revision: patched.revision,
      blocks: patched.blocks,
    });
  });
  // A hot-replaced module wires again, so the old listeners must not apply patches twice.
  import.meta.hot?.dispose(() => {
    stopRemovals();
    stopPatches();
  });
}

function childTranscriptQuery(taskId: string, childKey: string) {
  const bridge = window.desktop?.agent;
  if (bridge) wire(bridge);
  return {
    queryKey: queryKey(taskId, childKey),
    queryFn: () => {
      if (!bridge) throw new Error('The agent bridge is unavailable.');
      const key = holdKey(taskId, childKey);
      holds.set(key, (holds.get(key) ?? 0) + 1);
      return bridge.childTranscript(taskId, childKey);
    },
    enabled: Boolean(bridge),
    // Patches keep a cached transcript current while it is held, so it never needs a refetch.
    staleTime: Infinity,
    gcTime: LINGER_MS,
    // A failed load retries on the next patch, as main keeps the hold.
    retry: false,
  };
}

/**
 * One child session's transcript while the drill-in view shows it. A transcript the subagent
 * list prefetched, or one still cached from an earlier visit, shows at once.
 */
export function useChildTranscript(
  taskId: string,
  childKey: string,
): { detail: ChildTranscriptDetail | null; error: string } {
  const { data, error } = useQuery(childTranscriptQuery(taskId, childKey), queryClient);
  return { detail: data ?? null, error: error ? messageOf(error) : '' };
}

/**
 * Prefetches the transcripts of the children a list shows while it is mounted, so opening one
 * finds it loaded. The list does not re-render as their patches arrive.
 */
export function usePrefetchChildTranscripts(taskId: string | null, childKeys: readonly string[]) {
  useQueries(
    {
      queries: taskId
        ? childKeys.map((childKey) => ({
            ...childTranscriptQuery(taskId, childKey),
            notifyOnChangeProps: [],
          }))
        : [],
    },
    queryClient,
  );
}
