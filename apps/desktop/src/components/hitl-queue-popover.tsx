import { useMemo, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Popover, PopoverAnchor, PopoverContent } from '@ai/ui/components/popover';
import { Button } from '@ai/ui/components/button';
import type { PermissionRequest } from '../../electron/agent/permission-schema';
import type { QueueState } from '../../electron/agent/transcript-schema';
import { HitlRegion } from './hitl-region';
import { QueueRegion } from './queue-region';
import './hitl-queue-popover.css';

/**
 * One Radix popover above the composer surface hosting the HITL region (top) and the queue
 * region (bottom). Controlled open follows `ModelConfigPopover`: derived from content plus a
 * manual-dismiss flag that resets whenever the request/queue signature changes, so a new
 * arrival reopens after a dismiss while a steady queue stays put.
 *
 * Focus and Esc are split by intent, not by layer. Radix auto-focus is disabled outright so a
 * queue-only arrival never steals the textarea; only the HITL controls autofocus, and only when
 * the active element is already outside the textarea. Esc inside the content dismisses the
 * popover and stops propagation so the panel-global Esc (new chat/hide) never fires; Esc on an
 * approval button declines instead and never reaches this handler.
 */
export function HitlQueuePopover({
  requests,
  queue,
  taskId,
  queueDisabled = false,
  onEditQueued,
  children,
}: {
  requests: PermissionRequest[];
  queue: QueueState;
  taskId: string | null;
  queueDisabled?: boolean;
  onEditQueued: (text: string) => void;
  /** The composer surface; the popover anchors to it without adding a visible trigger. */
  children: ReactElement;
}) {
  // A dismiss applies only to the exact content signature it dismissed: any arrival,
  // resolution, or queue edit produces a new signature and reopens. Empty content clears the
  // dismiss during render so identical content returning later still opens.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const { t } = useTranslation('tasks');
  const { t: tp } = useTranslation('panel');
  const signature = useMemo(
    () => `${requests.map((request) => request.id).join(',')}|${JSON.stringify(queue)}`,
    [requests, queue],
  );
  const queueCount = queue.steering.length + queue.followUp.length;
  const hasQueue = taskId !== null && queueCount > 0;
  const hasContent = requests.length > 0 || hasQueue;
  if (!hasContent && dismissedFor !== null) setDismissedFor(null);
  const open = hasContent && dismissedFor !== signature;
  const dismissedWithContent = hasContent && dismissedFor === signature;
  const dismiss = () => setDismissedFor(signature);

  function onContentKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    dismiss();
    // The dismissed content unmounts under focused fingers; return focus to the recall
    // control that replaces it so keyboard users stay oriented.
    requestAnimationFrame(() => {
      const recall = document.querySelector('.hitl-queue-recall button');
      if (recall instanceof HTMLButtonElement) recall.focus();
    });
  }

  function recall() {
    setDismissedFor(null);
    // The recall control unmounts as the popover opens; park focus on the first popover
    // action so keyboard users don't drop to body. Appearance alone never moves focus.
    requestAnimationFrame(() => {
      const action = document.querySelector('.hitl-queue-popover button:not([disabled])');
      if (action instanceof HTMLButtonElement) action.focus();
    });
  }

  // Reuses the same waiting labels as the regions: approvals win over answers, queue count
  // covers queue-only. No new copy invented.
  const recallLabel =
    requests.length > 0
      ? requests.some((request) => request.kind === 'confirmation')
        ? t('permission.waitingApproval')
        : t('permission.waitingAnswer')
      : tp('composer.queuedCount', { count: queueCount });

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <PopoverAnchor asChild>
        <div className="hitl-queue-anchor">
          {children}
          {dismissedWithContent && (
            <span className="hitl-queue-recall" aria-live="polite">
              <Button type="button" variant="secondary" size="sm" onClick={recall}>
                {recallLabel}
              </Button>
            </span>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="center"
        sideOffset={8}
        collisionPadding={8}
        className="p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onKeyDown={onContentKeyDown}
      >
        <div className="hitl-queue-popover">
          {requests.length > 0 && <HitlRegion requests={requests} />}
          {hasQueue && taskId !== null && (
            <QueueRegion
              taskId={taskId}
              queue={queue}
              disabled={queueDisabled}
              onEdit={onEditQueued}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
