import { useTranslation } from 'react-i18next';
import type { AgentTask } from '../../client/agent/task-schema';
import { showErrorToast, showToast } from '../../components/toast-store';
import { agentApi } from './use-agent';

/** Copies the task id, the session's identity from creation on, and confirms with a toast. */
export function useCopyTaskId(): (task: AgentTask) => Promise<void> {
  const { t } = useTranslation('panel');
  return async (task) => {
    try {
      await agentApi().copy(task.id);
      showToast({ kind: 'info', text: t('session.idCopied') });
    } catch (error) {
      showErrorToast(error);
    }
  };
}
