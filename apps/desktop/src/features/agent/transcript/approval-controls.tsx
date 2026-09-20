import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Kbd } from '@ai/ui/components/kbd';
import type { ConfirmationRequest } from '../../../../electron/agent/permission-schema';
import { agentApi } from '../use-agent';
import { messageOf } from '../../../lib/errors';
import { DetailBox } from './detail-box';
import { scopeKey } from './tool-copy';

/** Display cap for the approval detail; the full value stays one copy click away. */
const DETAIL_PREVIEW_CHARS = 2000;

export function ApprovalControls({ request }: { request: ConfirmationRequest }) {
  const { t } = useTranslation('tasks');
  const onceRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const detail = request.detail;
  const preview =
    detail.length > DETAIL_PREVIEW_CHARS ? `${detail.slice(0, DETAIL_PREVIEW_CHARS)}…` : detail;

  useEffect(() => {
    // A HITL arrival autofocuses only when the user is not typing an answer already.
    if (document.activeElement instanceof HTMLTextAreaElement) return;
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
      // Decline, not dismiss: stopping propagation keeps the popover-level Esc handler (and the
      // panel-global one) from firing, so the queue region survives a button-focused decline.
      event.preventDefault();
      event.stopPropagation();
      void respond('declined');
    }
  }

  return (
    <div className="approval-controls">
      <p className="text-sm font-medium">{t(scopeKey(request.scope))}</p>
      {detail ? (
        <DetailBox variant="output" copyText={detail}>
          <pre className="m-0 whitespace-pre-wrap wrap-anywhere">{preview}</pre>
        </DetailBox>
      ) : null}
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
