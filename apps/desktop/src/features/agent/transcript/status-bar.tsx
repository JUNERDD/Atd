import { CircleAlert, CircleQuestionMark, CircleSlash, CircleStop } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@ai/ui/components/alert';
import type { TaskRun } from '../../../../electron/agent/task-schema';

const NOTES = {
  stopped: { icon: CircleStop, key: 'conversation.stopped' },
  interrupted: { icon: CircleSlash, key: 'conversation.interrupted' },
  unknown: { icon: CircleQuestionMark, key: 'conversation.unknown' },
  failed: { icon: CircleAlert, key: 'conversation.failed' },
} as const;

/**
 * Terminal note after a stop, interruption, failure or unknown outcome, closing the last turn.
 * It is the app's own status, not agent text, so it reads as an alert rather than prose; a
 * failure takes the destructive variant with the run's error as its description. Cancelled runs
 * render nothing inline. Live and waiting copy lives with the per-turn footer instead, so the
 * elapsed time, model, and waiting label render once, on the turn they belong to.
 */
export function StatusBar({ run }: { run: TaskRun | undefined }) {
  const { t } = useTranslation('tasks');
  const status = run?.status;
  if (
    status !== 'stopped' &&
    status !== 'interrupted' &&
    status !== 'unknown' &&
    status !== 'failed'
  )
    return null;
  const { icon: Icon, key } = NOTES[status];
  return (
    <Alert variant={status === 'failed' ? 'destructive' : 'default'}>
      <Icon aria-hidden />
      <AlertTitle>{t(key)}</AlertTitle>
      {run?.error && <AlertDescription className="wrap-anywhere">{run.error}</AlertDescription>}
    </Alert>
  );
}
