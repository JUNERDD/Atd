import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';
import type { BlockOf } from '../../../../electron/agent/transcript-schema';
import type { InputRequest } from '../../../../electron/agent/permission-schema';
import { IconButton } from '../../../components/icon-button';
import { agentApi } from '../use-agent';
import { messageOf } from '../../../lib/errors';

/**
 * Inline question row: title plus waiting text while pending, stored answer once settled.
 * Choices live in the composer popover (`QuestionControls`); the transcript never renders them.
 */
export function QuestionBlock({
  block,
  request,
}: {
  block: BlockOf<'question'>;
  request?: InputRequest;
}) {
  const { t } = useTranslation('tasks');
  return (
    <section className="question-block" aria-label={block.title}>
      <p className="text-sm font-medium">{block.title}</p>
      {request ? (
        <p className="text-sm text-muted-foreground">{t('permission.waitingAnswer')}</p>
      ) : (
        <p className="text-sm text-muted-foreground">
          {block.skipped ? t('question.skipped') : (block.answer ?? '')}
        </p>
      )}
    </section>
  );
}

/**
 * Popover input controls for one pending question: option chips, a free-text answer field
 * (Enter to send), and skip. Autofocuses the first chip only when the user is not typing in
 * the composer textarea; Esc bubbles to the popover content to dismiss, never to skip.
 */
export function QuestionControls({ request }: { request: InputRequest }) {
  const { t } = useTranslation('tasks');
  const { t: tp } = useTranslation('panel');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const firstOptionRef = useRef<HTMLButtonElement>(null);
  const answerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document.activeElement instanceof HTMLTextAreaElement) return;
    (firstOptionRef.current ?? answerRef.current)?.focus();
  }, [request.id]);

  async function respond(answer: { answer: string } | { skipped: true }) {
    if (pending) return;
    if ('answer' in answer && !answer.answer.trim()) return;
    setPending(true);
    setError('');
    try {
      await agentApi().answer(request.taskId, request.runId, request.id, answer);
      setDraft('');
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="question-block">
      <p className="text-sm font-medium">{request.title}</p>
      {request.options.length > 0 && (
        <div className="question-options">
          {request.options.map((option, index) => (
            <Button
              key={`${index}:${option}`}
              ref={index === 0 ? firstOptionRef : undefined}
              variant="outline"
              size="sm"
              className="question-option"
              disabled={pending}
              onClick={() => void respond({ answer: option })}
            >
              {option}
            </Button>
          ))}
        </div>
      )}
      <form
        className="flex min-w-0 items-center gap-1"
        onSubmit={(event) => {
          event.preventDefault();
          void respond({ answer: draft.trim() });
        }}
      >
        <Input
          ref={answerRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={tp('composer.answerPlaceholder')}
          aria-label={tp('composer.answerPlaceholder')}
          maxLength={10000}
          disabled={pending}
        />
        <IconButton label={tp('composer.send')} tooltipSide="top" disabled={pending} type="submit">
          <ArrowUp />
        </IconButton>
      </form>
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => void respond({ skipped: true })}
      >
        {t('question.skip')}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
