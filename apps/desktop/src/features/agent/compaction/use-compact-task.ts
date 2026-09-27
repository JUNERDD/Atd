import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { showErrorToast, showToast } from '../../../components/toast-store';
import { agentApi } from '../use-agent';

/**
 * Starts a manual compaction of one task. The service only accepts it here; progress and the
 * outcome arrive as the task's `compaction` block and context state, so success shows nothing
 * extra. A refusal (a run started, nothing to compact) arrives as a code and shows as a warning
 * toast in the interface language; any other failure shows as an error toast.
 * `pending` covers the request alone and ignores repeated calls while it is in flight.
 */
export function useCompactTask(): {
  compact: (taskId: string, instructions?: string) => Promise<void>;
  pending: boolean;
} {
  const { t } = useTranslation('tasks');
  const [pending, setPending] = useState(false);
  const inflight = useRef(false);
  const compact = useCallback(
    async (taskId: string, instructions?: string) => {
      if (inflight.current) return;
      inflight.current = true;
      setPending(true);
      try {
        const focus = instructions?.trim();
        const refused = await agentApi().compactTask(taskId, focus || undefined);
        if (refused) showToast({ kind: 'warning', text: t(`compaction.refused.${refused}`) });
      } catch (error) {
        showErrorToast(error);
      } finally {
        inflight.current = false;
        setPending(false);
      }
    },
    [t],
  );
  return { compact, pending };
}
