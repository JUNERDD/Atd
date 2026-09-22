import { useTranslation } from 'react-i18next';
import type { TaskRun } from '../../../../electron/agent/task-schema';

/**
 * Terminal transcript note after a stop, interruption, failure or unknown
 * outcome. Cancelled runs render nothing inline. Live and waiting copy lives
 * with the per-turn footer instead, so the elapsed time, model, and waiting
 * label render once, on the turn they belong to.
 */
export function StatusBar({ run }: { run: TaskRun | undefined }) {
  const { t } = useTranslation('tasks');
  if (
    run &&
    (run.status === 'stopped' ||
      run.status === 'interrupted' ||
      run.status === 'unknown' ||
      run.status === 'failed')
  ) {
    return (
      <div className="transcript-status">
        <p className="text-sm font-medium">
          {run.status === 'stopped'
            ? t('conversation.stopped')
            : run.status === 'interrupted'
              ? t('conversation.interrupted')
              : run.status === 'unknown'
                ? t('conversation.unknown')
                : t('conversation.failed')}
        </p>
        {run.error && <p className="text-sm text-destructive">{run.error}</p>}
      </div>
    );
  }
  return null;
}
