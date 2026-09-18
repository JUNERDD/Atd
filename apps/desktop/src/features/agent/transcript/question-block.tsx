import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import type { BlockOf } from '../../../../electron/agent/transcript-schema';
import type { InputRequest } from '../../../../electron/agent/permission-schema';
import { agentApi } from '../use-agent';
import { messageOf } from '../../../lib/errors';

export function QuestionBlock({
  block,
  request,
}: {
  block: BlockOf<'question'>;
  request?: InputRequest;
}) {
  const { t } = useTranslation('tasks');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const waiting = Boolean(request);

  async function respond(answer: { answer: string } | { skipped: true }) {
    if (!request || pending) return;
    setPending(true);
    setError('');
    try {
      await agentApi().answer(request.taskId, request.runId, request.id, answer);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="question-block" aria-label={block.title}>
      <p className="text-sm font-medium">{block.title}</p>
      {waiting ? (
        <>
          <div className="question-options">
            {block.options.map((option) => (
              <Button
                key={option}
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
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => void respond({ skipped: true })}
          >
            {t('question.skip')}
          </Button>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {block.skipped ? t('question.skipped') : (block.answer ?? '')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
