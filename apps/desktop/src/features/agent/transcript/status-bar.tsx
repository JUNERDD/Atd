import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import type { TaskRun } from '../../../../electron/agent/task-schema';
import { showErrorToast } from '../../../components/toast-store';

/**
 * Terminal transcript card: continue plus review after a stop or interruption. Failed and
 * cancelled runs render nothing inline. Live and waiting copy lives with the per-turn footer
 * instead, so the elapsed time, model, and waiting label render once, on the turn they belong to.
 */
export function StatusBar({
  run,
  onContinue,
  onReview,
}: {
  run: TaskRun | undefined;
  onContinue: () => Promise<unknown>;
  onReview: () => void;
}) {
  const { t } = useTranslation('tasks');
  const [pending, setPending] = useState(false);
  if (run && (run.status === 'stopped' || run.status === 'interrupted')) {
    return (
      <div className="transcript-status">
        <p className="text-sm font-medium">
          {run.status === 'stopped' ? t('conversation.stopped') : t('conversation.interrupted')}
        </p>
        {run.error && <p className="text-sm text-destructive">{run.error}</p>}
        <div className="status-actions">
          <Button
            disabled={pending}
            onClick={() => {
              setPending(true);
              void onContinue()
                .catch((error) => showErrorToast(error))
                .finally(() => setPending(false));
            }}
          >
            {t('conversation.continue')}
          </Button>
          <Button variant="outline" onClick={onReview}>
            {t('review.title')}
          </Button>
        </div>
      </div>
    );
  }
  return null;
}
