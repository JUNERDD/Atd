import { useState } from 'react';
import { Button } from '@ai/ui/components/button';
import { Textarea } from '@ai/ui/components/textarea';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { ShieldQuestion } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PermissionRequest } from '../../../electron/agent/task-schema';
import { agentApi } from './use-agent';
import { messageOf } from '../../lib/errors';

export function TaskRequest({ request }: { request: PermissionRequest }) {
  const { t } = useTranslation('tasks');
  const [answer, setAnswer] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function respond(value: string | boolean) {
    setPending(true);
    setError('');
    try {
      await agentApi().answer(request.taskId, request.runId, request.id, value);
    } catch (error) {
      setError(messageOf(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      className="task-request"
      aria-label={
        request.kind === 'input' ? t('request.inputNeeded') : t('request.confirmationNeeded')
      }
    >
      <div className="flex items-start gap-2">
        <ShieldQuestion size={16} className="shrink-0 mt-0.5" />
        <h2 className="min-w-0 truncate text-sm font-medium" title={request.title}>
          {request.title}
        </h2>
      </div>
      {request.detail && (
        <ScrollArea className="review-text" viewportClassName="text-preview-viewport">
          <pre>{request.detail}</pre>
        </ScrollArea>
      )}
      {request.kind === 'input' && (
        <>
          <div className="flex flex-wrap gap-2">
            {request.options.map((option) => (
              <Button
                key={option}
                variant="outline"
                size="sm"
                className="task-request-option"
                disabled={pending}
                onClick={() => void respond(option)}
              >
                {option}
              </Button>
            ))}
          </div>
          <ScrollArea className="panel-text-scroll" viewportClassName="text-preview-viewport">
            <Textarea
              aria-label={t('request.answerLabel')}
              className="overflow-hidden"
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder={t('request.answerPlaceholder')}
            />
          </ScrollArea>
        </>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={pending} onClick={() => void respond(false)}>
          {request.kind === 'input' ? t('request.skip') : t('request.decline')}
        </Button>
        <Button
          disabled={pending || (request.kind === 'input' && !answer.trim())}
          onClick={() => void respond(request.kind === 'input' ? answer : true)}
        >
          {pending
            ? t('request.submitting')
            : request.kind === 'input'
              ? t('request.respond')
              : t('request.allowOnce')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
