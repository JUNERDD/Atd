import { useEffect } from 'react';
import { showToast } from '../../components/toast-store';

/** Surfaces background Agent notices as global toasts, independent of the open task. */
export function useAgentNotices() {
  useEffect(() => {
    const bridge = window.desktop?.agent;
    if (!bridge) return;
    return bridge.onChange((event) => {
      if (event.type !== 'notice') return;
      const { taskId, text, kind } = event.notice;
      showToast({ kind, text, id: `notice-${taskId}` });
    });
  }, []);
}
