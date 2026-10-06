import { useTranslation } from 'react-i18next';
import { CircleAlert, CircleCheck, CirclePause } from 'lucide-react';
import type { AutomationStatus } from '@atd/agent-contracts';
import { Alert, AlertDescription } from '@atd/ui/components/alert';
import { problemWords } from './automation-words';

/**
 * Why a saved automation does not run as it stands, above its editor and its run history: a
 * problem the service found, or the service turned it off (repeated failures, or its one-time run
 * is done). Nothing shows while it can run.
 */
export function AutomationStatusNotice({ status }: { status: AutomationStatus }) {
  const { t } = useTranslation('automations');
  if (status.problem)
    return (
      <Alert variant="destructive">
        <CircleAlert />
        <AlertDescription>{problemWords(status.problem, t)}</AlertDescription>
      </Alert>
    );
  if (status.pausedReason === 'failures')
    return (
      <Alert role="note" className="automation-paused-notice">
        <CirclePause />
        <AlertDescription>{t('status.pausedFailuresNotice')}</AlertDescription>
      </Alert>
    );
  if (status.pausedReason === 'finished')
    return (
      <Alert role="note">
        <CircleCheck />
        <AlertDescription>{t('status.pausedFinishedNotice')}</AlertDescription>
      </Alert>
    );
  return null;
}
