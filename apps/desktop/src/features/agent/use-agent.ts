import { useEffect, useState } from 'react';
import type { AgentNotice, AgentSnapshot, TaskDetail } from '../../../electron/agent/bridge';

export function agentApi() {
  if (!window.desktop?.agent)
    throw new Error('Open the desktop app to run tasks and manage saved data.');
  return window.desktop.agent;
}
export function messageOf(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    : 'The operation could not finish.';
}

export function useAgent() {
  const [snapshot, setSnapshot] = useState<AgentSnapshot | null>(null);
  const [error, setError] = useState('');
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
        if (active) setError(messageOf(error));
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return { snapshot, error: error || snapshot?.error || '', setError };
}

export function useTaskDetail(taskId: string | null) {
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [notice, setNotice] = useState<AgentNotice | null>(null);
  const [failure, setFailure] = useState<{ taskId: string; message: string } | null>(null);
  useEffect(() => {
    if (!taskId || !window.desktop?.agent) return;
    let active = true;
    let received = false;
    const unsubscribe = window.desktop.agent.onChange((event) => {
      if (event.type === 'task' && event.detail.task.id === taskId) {
        received = true;
        setDetail(event.detail);
      }
      if (event.type === 'notice' && event.notice.taskId === taskId) setNotice(event.notice);
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
        if (active) setFailure({ taskId, message: messageOf(error) });
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [taskId]);
  return {
    detail: detail?.task.id === taskId ? detail : null,
    notice: notice?.taskId === taskId ? notice : null,
    dismissNotice: () => setNotice(null),
    error: failure?.taskId === taskId ? failure.message : '',
  };
}
