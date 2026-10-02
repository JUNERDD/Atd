import { useEffect, useState } from 'react';
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { AgentSnapshot, TaskDetail, TaskState } from '../../client/agent/bridge';
import { applyTranscriptPatch } from '../../client/agent/transcript-schema';
import { showErrorToast } from '../../components/toast-store';
import i18n from '../../i18n';
import { bridgeKeys, newerAgentSnapshot, wireAgentBridge } from '../../lib/bridge-cache';
import { queryClient } from '../../lib/query-client';

export function agentApi() {
  if (!window.desktop?.agent) throw new Error(i18n.t('panel:errors.openDesktopApp'));
  return window.desktop.agent;
}

function agentSnapshotQuery() {
  const bridge = window.desktop?.agent;
  return queryOptions({
    queryKey: bridgeKeys.agentSnapshot,
    queryFn: () => {
      if (!bridge) throw new Error(i18n.t('panel:errors.openDesktopApp'));
      wireAgentBridge(bridge);
      // A snapshot pushed while the read ran may be newer than its answer.
      return bridge
        .get()
        .then((next) =>
          newerAgentSnapshot(
            queryClient.getQueryData<AgentSnapshot>(bridgeKeys.agentSnapshot),
            next,
          ),
        );
    },
    enabled: Boolean(bridge),
    // Pushes keep the snapshot current, so it never needs a refetch.
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

/**
 * The agent snapshot (commands and tasks), shared by every caller in the window and kept current
 * by the bridge's pushes. A failed read, and a snapshot error, show their toasts once.
 */
export function useAgent(): { snapshot: AgentSnapshot | null } {
  const { data } = useQuery(agentSnapshotQuery(), queryClient);
  return { snapshot: data ?? null };
}

function mergeState(detail: TaskDetail, state: TaskState): TaskDetail {
  return { ...detail, ...state, revision: detail.revision, blocks: detail.blocks };
}

export function useTaskDetail(taskId: string | null): { detail: TaskDetail | null } {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  useEffect(() => {
    if (!taskId || !window.desktop?.agent) return;
    const bridge = window.desktop.agent;
    let active = true;
    let seq = 0;
    let current: TaskDetail | null = null;
    let queuedState: TaskState | null = null;
    let waitingForSeed = false;
    let frame = 0;

    const commit = () => {
      frame = 0;
      setDetail(current);
    };
    // `current` always takes each update at once, so the revision chain stays exact. Seeds and task
    // state commit immediately (carrying any pending patches); streamed transcript patches commit
    // at most once per animation frame, sparing a render per token.
    const publish = (next: TaskDetail, streamed = false) => {
      current = next;
      waitingForSeed = false;
      if (!streamed) {
        cancelAnimationFrame(frame);
        commit();
      } else if (!frame) frame = requestAnimationFrame(commit);
    };

    const seed = () => {
      const request = ++seq;
      waitingForSeed = true;
      void bridge.detail(taskId).then(
        (value) => {
          if (!active || request !== seq) return;
          const state = queuedState;
          queuedState = null;
          publish(state && state.task.id === taskId ? mergeState(value, state) : value);
        },
        (error) => {
          if (active && request === seq) showErrorToast(error);
        },
      );
    };

    const unsubscribe = bridge.onChange((event) => {
      if (event.type === 'task' && event.state.task.id === taskId) {
        if (!current) queuedState = event.state;
        else publish(mergeState(current, event.state));
        return;
      }
      if (event.type !== 'transcript' || event.patch.taskId !== taskId) return;
      // A seed in flight already returns a snapshot at least as new as this patch; patches that
      // land between that snapshot and the next event surface as a revision gap and reseed once.
      if (waitingForSeed) return;
      if (!current) {
        seed();
        return;
      }
      const patched = applyTranscriptPatch(
        { revision: current.revision, blocks: current.blocks },
        event.patch,
      );
      if (!patched) {
        seed();
        return;
      }
      publish({ ...current, revision: patched.revision, blocks: patched.blocks }, true);
    });
    seed();
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [taskId]);
  return { detail: detail?.task.id === taskId ? detail : null };
}
