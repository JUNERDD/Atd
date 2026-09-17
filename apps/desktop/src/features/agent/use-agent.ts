import { useEffect, useState } from 'react';
import type { AgentSnapshot, TaskDetail } from '../../../electron/agent/bridge';
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

export function useTaskDetail(taskId: string | null) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  useEffect(() => {
    if (!taskId || !window.desktop?.agent) return;
    let active = true;
    let received = false;
    const unsubscribe = window.desktop.agent.onChange((event) => {
      if (event.type === 'task' && event.detail.task.id === taskId) {
        received = true;
        setDetail(event.detail);
      }
      if (event.type === 'snapshot')
        setDetail((previous) => {
          const task = event.snapshot.tasks.find((task) => task.id === taskId);
          return task && previous?.task.id === taskId ? { ...previous, task } : previous;
        });
    });
    void window.desktop.agent.detail(taskId).then(
      (value) => {
        if (active && !received) setDetail(value);
      },
      (error) => {
        if (active) showErrorToast(error);
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [taskId]);
  return { detail: detail?.task.id === taskId ? detail : null };
}
