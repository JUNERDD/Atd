import { useEffect, useEffectEvent } from 'react';
import { flushSync } from 'react-dom';
import { showPanel } from './use-panel-window';

/**
 * The mini panel's New task, which the shell hands to the panel page without showing the panel.
 * The page starts a new task as its own New task button does (`newTask` leaves the open task or
 * view for the new task's composer, which keeps the draft it was left with), then shows the panel
 * once a frame of that view is drawn, so the view it was left on never shows first. The hidden
 * panel keeps drawing frames; a hidden document draws none (the panel on another Space or
 * minimized), so it shows the panel at once.
 */
export function useNewTaskRequest(newTask: () => void): void {
  const start = useEffectEvent(() => {
    flushSync(newTask);
    if (document.visibilityState === 'hidden') return void showPanel();
    // The second frame's callback runs once the first, which holds the new task, is drawn.
    requestAnimationFrame(() => requestAnimationFrame(() => void showPanel()));
  });
  useEffect(() => window.desktop?.onNewTask?.(() => start()), []);
}
