import { useLayoutEffect } from 'react';

/**
 * Tells the shell which task the panel shows (`null` for none), on mount and on every change, so a
 * notification for the task the person is looking at is not sent. The page mounts after the native
 * host is installed, so the first report is never lost.
 */
export function useTaskShown(taskId: string | null) {
  useLayoutEffect(() => {
    window.desktop?.notifications?.taskShown?.(taskId);
  }, [taskId]);
}
