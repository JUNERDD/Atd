import { useCallback, useRef, useState } from 'react';
import { showErrorToast } from '../../../components/toast-store';
import { agentApi } from '../use-agent';

/**
 * Starts a manual compaction of one task. The service only accepts it here; progress and the
 * outcome arrive as the task's `compaction` block and context state, so success shows nothing
 * extra. A refusal (a run started, nothing to compact) shows the service's reason as a toast.
 * `pending` covers the request alone and ignores repeated calls while it is in flight.
 */
export function useCompactTask(): {
  compact: (taskId: string, instructions?: string) => Promise<void>;
  pending: boolean;
} {
  const [pending, setPending] = useState(false);
  const inflight = useRef(false);
  const compact = useCallback(async (taskId: string, instructions?: string) => {
    if (inflight.current) return;
    inflight.current = true;
    setPending(true);
    try {
      const focus = instructions?.trim();
      await agentApi().compactTask(taskId, focus || undefined);
    } catch (error) {
      showErrorToast(error);
    } finally {
      inflight.current = false;
      setPending(false);
    }
  }, []);
  return { compact, pending };
}
