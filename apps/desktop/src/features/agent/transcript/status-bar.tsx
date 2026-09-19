import { useTranslation } from 'react-i18next';
import type { TaskRun } from '../../../../electron/agent/task-schema';

/**
 * Terminal transcript note after a stop or interruption. Failed and cancelled runs render
 * nothing inline. Live and waiting copy lives with the per-turn footer instead, so the elapsed
 * time, model, and waiting label render once, on the turn they belong to.
 */
export function StatusBar({ run }: { run: TaskRun | undefined }) {
  const { t } = useTranslation('tasks');
  if (run && (run.status === 'stopped' || run.status === 'interrupted')) {
    return (
      <div className="transcript-status">
        <p className="text-sm font-medium">
          {run.status === 'stopped' ? t('conversation.stopped') : t('conversation.interrupted')}
        </p>
        {run.error && <p className="text-sm text-destructive">{run.error}</p>}
      </div>
    );
  }
  return null;
}
