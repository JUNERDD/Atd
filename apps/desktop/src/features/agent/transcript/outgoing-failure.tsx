import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@atd/ui/components/alert';
import { Button } from '@atd/ui/components/button';
import type { OutgoingMessage } from '../outgoing-messages';

/**
 * Where the reply to a message the service did not take would be: the failed run's alert
 * (`StatusBar`) with the reason, Retry, which sends the same invocation again, and Discard, which
 * drops the message, and the new chat it would have started. Until either, the message stays in
 * its bubble, for copying, rather than going back into the composer.
 */
export function OutgoingFailure({ message, error }: { message: OutgoingMessage; error: string }) {
  const { t } = useTranslation('tasks');
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden />
      <AlertTitle>{t('conversation.notSent')}</AlertTitle>
      <AlertDescription className="wrap-anywhere">{error}</AlertDescription>
      <AlertAction className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={message.discard}>
          {t('conversation.discardUnsent')}
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={message.retry}>
          {t('conversation.retrySend')}
        </Button>
      </AlertAction>
    </Alert>
  );
}
