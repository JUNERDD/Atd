import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageCircleQuestion } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Input } from '@ai/ui/components/input';
import { Shimmer } from '@ai/ui/components/ai-elements/shimmer';
import type { BlockOf } from '../../../../electron/agent/transcript-schema';
import type { InputRequest } from '../../../../electron/agent/permission-schema';
import { agentApi } from '../use-agent';
import { messageOf } from '../../../lib/errors';
import { ActivityRow } from './activity-row';
import { DetailBox } from './detail-box';
import { statusLabelKey } from './tool-copy';

/**
 * Question row in the normal tool-call chrome: leading icon, truncated title, trailing meta,
 * and an expandable body with the offered options plus the stored answer. Answering lives in
 * the composer popover (`QuestionControls`); the transcript never renders choice buttons.
 */
export function QuestionBlock({
  block,
  request,
}: {
  block: BlockOf<'question'>;
  request?: InputRequest;
}) {
  const { t } = useTranslation('tasks');
  const [open, setOpen] = useState(false);
  const running = block.status === 'running';
  const meta = request
    ? t('permission.waitingAnswer')
    : block.skipped
      ? t('question.skipped')
      : (block.answer ?? t(statusLabelKey(block.status)));
  const answer = !request && !block.skipped ? block.answer : null;
  const heading = (
    <>
      <ActivityRow.Title className="flex-initial" title={block.title}>
        {running ? <Shimmer as="span">{block.title}</Shimmer> : block.title}
      </ActivityRow.Title>
      {meta ? (
        <ActivityRow.Meta className="activity-meta" title={meta}>
          {meta}
        </ActivityRow.Meta>
      ) : null}
    </>
  );
  // No options and no stored answer: nothing to expand into, so render the static frame
  // without a trigger instead of an expandable row with an empty body.
  if (block.options.length === 0 && answer === null) {
    return (
      <div className="question-block">
        <ActivityRow.Root status={block.status}>
          <div className="activity-row-static">
            <ActivityRow.Icon chevron={false}>
              <MessageCircleQuestion className="row-icon" strokeWidth={1.75} />
            </ActivityRow.Icon>
            {heading}
          </div>
        </ActivityRow.Root>
      </div>
    );
  }
  return (
    <div className="question-block">
      <ActivityRow.Root open={open} onOpenChange={setOpen} status={block.status}>
        <ActivityRow.Trigger>
          <ActivityRow.Icon>
            <MessageCircleQuestion className="row-icon" strokeWidth={1.75} />
          </ActivityRow.Icon>
          {heading}
        </ActivityRow.Trigger>
        <ActivityRow.Content>
          <ActivityRow.Body className="question-body">
            <DetailBox variant="output" copyText={answer ?? undefined}>
              {block.options.length > 0 && (
                <ul className="question-option-list">
                  {block.options.map((option, index) => (
                    <li key={`${index}:${option}`}>{option}</li>
                  ))}
                </ul>
              )}
              {answer ? <p className="question-answer">{answer}</p> : null}
            </DetailBox>
          </ActivityRow.Body>
        </ActivityRow.Content>
      </ActivityRow.Root>
    </div>
  );
}

/**
 * Popover answer form for one pending question: title, option chips, a full-width free-text
 * field (Enter to send), and right-aligned Skip/Send actions. Autofocuses the first chip only
 * when the user is not typing in the composer textarea; Esc bubbles to the popover content to
 * dismiss, never to skip.
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
    <div className="question-form">
      <p className="text-sm font-medium">{request.title}</p>
      {request.executionId?.startsWith('child:') && (
        <p className="text-xs text-muted-foreground">
          {tp('confirms.subtask', { execution: request.executionId })}
        </p>
      )}
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
        className="question-answer-form"
        onSubmit={(event) => {
          event.preventDefault();
          // The popover portals this form out of the composer's DOM, but React still bubbles the
          // submit to the composer form, which would send its own draft as a second answer.
          event.stopPropagation();
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
            onClick={() => void respond({ skipped: true })}
          >
            {t('question.skip')}
          </Button>
          <Button type="submit" size="sm" disabled={pending || !draft.trim()}>
            {t('question.send')}
          </Button>
        </div>
      </form>
    </div>
  );
}
