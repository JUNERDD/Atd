import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';
import type { InputRequest } from '../../../client/agent/permission-schema';
import { messageOf } from '../../../lib/errors';
import { isTextEntryFocused } from '../../../lib/text-entry';
import { agentApi } from '../use-agent';
import { openWaitingView } from './view-open';

/**
 * The composer popover's part for a view that waits for the user's response (`show_ui` with
 * `wait`). The response is given in the view's window, so this only points there: the view's
 * title, where to respond, Open view (which opens the view's window, or brings it forward), and
 * Skip, which answers that the user dismissed the view. Enter in the composer still answers it
 * with the draft's text. Focus moves to Open view on mount only when the user is not typing.
 */
export function ViewRequestControls({
  request,
  focusOnMount = true,
}: {
  request: InputRequest;
  /** Focus Open view on mount; off after the popover pages. */
  focusOnMount?: boolean;
}) {
  const { t } = useTranslation('tasks');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const openRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!focusOnMount || isTextEntryFocused()) return;
    openRef.current?.focus();
  }, [request.id, focusOnMount]);

  async function skip() {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await agentApi().answer(request.taskId, request.runId, request.id, { skipped: true });
    } catch (cause) {
      setError(messageOf(cause));
    }
    setPending(false);
  }

  return (
    <div className="question-form">
      <p className="text-sm font-medium">{request.title}</p>
      <p className="text-sm text-muted-foreground">{t('view.respondInWindow')}</p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="question-actions">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => void skip()}
        >
          {t('question.skip')}
        </Button>
        <Button
          ref={openRef}
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void openWaitingView(request)}
        >
          {t('view.open')}
        </Button>
      </div>
    </div>
  );
}
