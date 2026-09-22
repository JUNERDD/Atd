import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Kbd, KbdGroup } from '@ai/ui/components/kbd';
import type { ConfirmationRequest } from '../../../../electron/agent/permission-schema';
import { agentApi } from '../use-agent';
import { messageOf } from '../../../lib/errors';
import { shortcutKeys } from '../../../lib/shortcuts';
import { DetailBox } from './detail-box';
import { scopeKey } from './tool-copy';

/** Display cap for the approval detail; the full value stays one copy click away. */
const DETAIL_PREVIEW_CHARS = 2000;

/** Platform shortcut hint in the shared launcher style (symbols on macOS, words elsewhere). */
function ShortcutHint({ accelerator }: { accelerator: string }) {
  const platform = window.desktop?.platform ?? 'web';
  return (
    <KbdGroup>
      {shortcutKeys(accelerator, platform).map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  );
}

export function ApprovalControls({
  request,
  hideTitle = false,
}: {
  request: ConfirmationRequest;
  /** Hide the scope title when the popover header already merges it (single approval). */
  hideTitle?: boolean;
}) {
  const { t } = useTranslation('tasks');
  const { t: tPanel } = useTranslation('panel');
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
    if (event.key === 'Enter' && event.shiftKey) {
      // Session grant from any focused decision: preventing default stops the focused button's
      // own Enter activation so only the session grant fires.
      event.preventDefault();
      event.stopPropagation();
      void respond('session');
      return;
    }
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
      {hideTitle ? null : <p className="text-sm font-medium">{t(scopeKey(request.scope))}</p>}
      {request.executionId?.startsWith('child:') && (
        <p className="text-xs text-muted-foreground">
          {tPanel('confirms.subtask', { execution: request.executionId })}
        </p>
      )}
      {detail ? (
        <DetailBox variant="output" copyText={detail} className="approval-detail">
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
          <ShortcutHint accelerator="Enter" />
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => void respond('session')}
          onKeyDown={onControlsKeyDown}
        >
          {t('permission.allowSession')}
          <ShortcutHint accelerator="Shift+Enter" />
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => void respond('declined')}
          onKeyDown={onControlsKeyDown}
        >
          {t('permission.decline')}
          <ShortcutHint accelerator="Escape" />
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
