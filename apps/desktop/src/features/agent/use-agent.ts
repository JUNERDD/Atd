import { useEffect, useState } from 'react';
import type { AgentSnapshot, TaskDetail, TaskState } from '../../../electron/agent/bridge';
import { applyTranscriptPatch } from '../../../electron/agent/transcript-schema';
import { showErrorToast } from '../../components/toast-store';
import i18n from '../../i18n';

export function agentApi() {
  if (!window.desktop?.agent) throw new Error(i18n.t('panel:errors.openDesktopApp'));
  return window.desktop.agent;
}

export function useAgent() {
  const [snapshot, setSnapshot] = useState<AgentSnapshot | null>(null);
  useEffect(() => {
    const bridge = window.desktop?.agent;
    if (!bridge) return;
    let active = true;
    const update = (next: AgentSnapshot) =>
      setSnapshot((previous) => (!previous || next.revision > previous.revision ? next : previous));
    const unsubscribe = bridge.onChange((event) => {
      if (event.type === 'snapshot') update(event.snapshot);
    });
    void bridge.get().then(
      (next) => {
        if (active) update(next);
      },
      (error) => {
        if (active) showErrorToast(error);
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  const error = snapshot?.error ?? '';
  useEffect(() => {
    if (error) showErrorToast(error);
  }, [error]);
  return { snapshot };
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

    const publish = (next: TaskDetail) => {
      current = next;
      waitingForSeed = false;
      setDetail(next);
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
      publish({ ...current, revision: patched.revision, blocks: patched.blocks });
    });
    seed();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [taskId]);
  return { detail: detail?.task.id === taskId ? detail : null };
}
