import { useState } from 'react';
import { Button } from '@ai/ui/components/button';
import { Textarea } from '@ai/ui/components/textarea';
import { ShieldQuestion } from 'lucide-react';
import type { PermissionRequest } from '../../../electron/agent/task-schema';
import { agentApi, messageOf } from './use-agent';

export function TaskRequest({ request }: { request: PermissionRequest }) {
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
      aria-label={request.kind === 'input' ? 'Input needed' : 'Confirmation needed'}
    >
      <div className="flex items-start gap-2">
        <ShieldQuestion size={16} className="shrink-0 mt-0.5" />
        <h2 className="text-sm font-medium">{request.title}</h2>
      </div>
      {request.detail && <pre className="review-text">{request.detail}</pre>}
      {request.kind === 'input' && (
        <>
          <div className="flex flex-wrap gap-2">
            {request.options.map((option) => (
              <Button
                key={option}
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => void respond(option)}
              >
                {option}
              </Button>
            ))}
          </div>
          <Textarea
            aria-label="Your answer"
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
            placeholder="Your answer…"
          />
        </>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={pending} onClick={() => void respond(false)}>
          {request.kind === 'input' ? 'Skip' : 'Decline'}
        </Button>
        <Button
          disabled={pending || (request.kind === 'input' && !answer.trim())}
          onClick={() => void respond(request.kind === 'input' ? answer : true)}
        >
          {pending ? 'Submitting…' : request.kind === 'input' ? 'Respond' : 'Allow once'}
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
