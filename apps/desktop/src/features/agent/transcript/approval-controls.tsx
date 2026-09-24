import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@ai/ui/components/button';
import { Kbd, KbdGroup } from '@ai/ui/components/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ai/ui/components/tooltip';
import type { ConfirmationRequest } from '../../../../electron/agent/permission-schema';
import { agentApi } from '../use-agent';
import { messageOf } from '../../../lib/errors';
import { shortcutKeys } from '../../../lib/shortcuts';
import { isTextEntryFocused } from '../../../lib/text-entry';
import { DetailBox } from './detail-box';
import { scopeKey } from './tool-copy';

/** Display cap for the approval detail; the full value stays one copy click away. */
const DETAIL_PREVIEW_CHARS = 2000;

/** Platform shortcut hint in the shared launcher style (symbols on macOS, words elsewhere). */
export function ShortcutHint({ accelerator }: { accelerator: string }) {
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
    // A HITL arrival autofocuses only when the user is not typing: Enter meant for the draft
    // must never approve.
    if (isTextEntryFocused()) return;
    onceRef.current?.focus();
  }, [request.id]);

  // Shell commands off the allowlist get allow once / add to allowlist / deny. A session grant is
  // never offered for them: the service does not cache one for bash.
  const bash = request.scope.tool === 'bash';
  const allowlistEntry = bash ? request.allowlistEntry : undefined;

  async function settle(action: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPending(false);
    }
  }
  const answer = (decision: 'once' | 'session' | 'declined') =>
    agentApi().answer(request.taskId, request.runId, request.id, { decision });
  const respond = (decision: 'once' | 'session' | 'declined') => settle(() => answer(decision));

  /**
   * Persists the suggested entry first (main saves it and pushes it to the service), then allows
   * this call. A failed save leaves the confirm pending so the user can still decide.
   */
  function addToAllowlist(entry: string) {
    return settle(async () => {
      const added = await window.desktop?.settings.addShellAllowlistEntry(entry).then(
        () => true,
        () => false,
      );
      if (!added) throw new Error(t('permission.bash.addFailed'));
      await answer('once');
    });
  }

  function onControlsKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (pending) return;
    if (event.key === 'Enter' && event.shiftKey) {
      // The second decision (session grant, or add to allowlist for bash) from any focused
      // decision: preventing default stops the focused button's own Enter activation.
      if (bash && !allowlistEntry) return;
      event.preventDefault();
      event.stopPropagation();
      void (allowlistEntry ? addToAllowlist(allowlistEntry) : respond('session'));
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
      {bash && (
        <p className="text-xs text-muted-foreground">{t('permission.bash.notAllowlisted')}</p>
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
          {bash ? t('permission.bash.allowOnce') : t('permission.allowOnce')}
          <ShortcutHint accelerator="Enter" />
        </Button>
        {allowlistEntry ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                className="max-w-full"
                disabled={pending}
                onClick={() => void addToAllowlist(allowlistEntry)}
                onKeyDown={onControlsKeyDown}
              >
                <span className="min-w-0 truncate">
                  {t('permission.bash.addToAllowlistEntry', { entry: allowlistEntry })}
                </span>
                <ShortcutHint accelerator="Shift+Enter" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              {t('permission.bash.allowlistHint', { entry: allowlistEntry })}
            </TooltipContent>
          </Tooltip>
        ) : bash ? null : (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => void respond('session')}
            onKeyDown={onControlsKeyDown}
          >
            {t('permission.allowSession')}
            <ShortcutHint accelerator="Shift+Enter" />
          </Button>
        )}
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => void respond('declined')}
          onKeyDown={onControlsKeyDown}
        >
          {bash ? t('permission.bash.deny') : t('permission.decline')}
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
