import { useTranslation } from 'react-i18next';
import type { AgentTask } from '../../../electron/agent/task-schema';
import { showErrorToast, showToast } from '../../components/toast-store';
import { agentApi } from './use-agent';
import { sessionLinkText } from './session-link';

/** Copies the task's Pi session link (or its id before the first run) and reports the result as a toast. */
export function useCopyTaskLink(): (task: AgentTask) => Promise<void> {
  const { t } = useTranslation('panel');
  return async (task) => {
    try {
      const { text, withSession } = sessionLinkText(task);
      await agentApi().copy(text);
      showToast({
        kind: 'info',
        text: withSession ? t('session.linkCopied') : t('session.idCopied'),
      });
    } catch (error) {
      showErrorToast(error);
    }
  };
}
