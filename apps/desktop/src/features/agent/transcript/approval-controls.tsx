import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Kbd } from '@ai/ui/components/kbd';
import type { ConfirmationRequest } from '../../../../electron/agent/permission-schema';
import { agentApi } from '../use-agent';
import { messageOf } from '../../../lib/errors';
import { scopeKey } from './tool-copy';

export function ApprovalControls({ request }: { request: ConfirmationRequest }) {
  const { t } = useTranslation('tasks');
  const onceRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    onceRef.current?.focus();
  }, [request.id]);

  async function respond(decision: 'once' | 'session' | 'declined') {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await agentApi().answer(request.taskId, request.runId, request.id, { decision });
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(false);
    }
  }

  function onControlsKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (pending) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      void respond('declined');
    }
  }

  return (
    <div className="approval-controls">
      <p className="text-sm font-medium">{t(scopeKey(request.scope))}</p>
      <div className="approval-actions">
        <Button
          ref={onceRef}
          disabled={pending}
          onClick={() => void respond('once')}
          onKeyDown={onControlsKeyDown}
        >
          {t('permission.allowOnce')}
          <Kbd>Enter</Kbd>
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => void respond('session')}
          onKeyDown={onControlsKeyDown}
        >
          {t('permission.allowSession')}
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => void respond('declined')}
          onKeyDown={onControlsKeyDown}
        >
          {t('permission.decline')}
          <Kbd>Esc</Kbd>
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
