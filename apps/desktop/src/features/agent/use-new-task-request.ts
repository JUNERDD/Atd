import { useEffect, useEffectEvent } from 'react';

/**
 * The mini panel's New task, which the shell hands to the panel page after it showed the panel.
 * The page starts a new task as its own New task button does: `newTask` leaves the open task or
 * view for the new task's composer, which keeps the draft it was left with. A request that
 * arrives before the page subscribes needs no replay, since a freshly loaded page already shows
 * a new task.
 */
export function useNewTaskRequest(newTask: () => void): void {
  const start = useEffectEvent(newTask);
  useEffect(() => window.desktop?.onNewTask?.(() => start()), []);
}
