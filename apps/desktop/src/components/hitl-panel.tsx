import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { motion } from 'motion/react';
import type { PermissionRequest } from '../client/agent/permission-schema';
import type { QueueState } from '../client/agent/transcript-schema';
import { HitlRegion } from './hitl-region';
import { IconButton } from './icon-button';
import { QueueRegion } from './queue-region';
import { useHitlPager, type HitlPager } from './use-hitl-pager';
import type { HitlSummary } from './use-hitl-summary';
import './hitl-queue-popover.css';

/**
 * Previous, `n / m`, next. Like the header close, the arrows carry no tooltip: the glyph and
 * accessible name suffice. Paging onto either end disables the button that got there, so focus
 * moves to the other one instead of dropping out of the popover.
 */
function PagerControls({ pager }: { pager: HitlPager }) {
  const { t } = useTranslation('tasks');
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const current = pager.position + 1;
  function go(delta: -1 | 1) {
    pager.go(delta);
    const target = pager.position + delta;
    // After the commit: with two requests the other button is still disabled until then.
    const other = target === 0 ? nextRef : target === pager.count - 1 ? previousRef : null;
    if (other) requestAnimationFrame(() => other.current?.focus());
  }
  return (
    <div className="hitl-queue-pager">
      <IconButton
        ref={previousRef}
        label={t('permission.pager.previous')}
        size="icon-xs"
        tooltip={false}
        disabled={current === 1}
        onClick={() => go(-1)}
      >
        <ChevronLeft />
      </IconButton>
      <span className="hitl-queue-pager-position">
        {t('permission.pager.position', { current, total: pager.count })}
      </span>
      <IconButton
        ref={nextRef}
        label={t('permission.pager.next')}
        size="icon-xs"
        tooltip={false}
        disabled={current === pager.count}
        onClick={() => go(1)}
      >
        <ChevronRight />
      </IconButton>
    </div>
  );
}

/**
 * The composer popover's HITL view: one pending request at a time (top, urgent) and the queue
 * (bottom) under a header whose close button dismisses the view, never resolves a request. With
 * several requests the header pages through them and shows `n / m`. The body owns scrolling so
 * neither region can push the composer surface around.
 */
export function HitlPanel({
  summary,
  requests,
  queue,
  taskId,
  queueDisabled,
  onEditQueued,
  onClose,
}: {
  summary: HitlSummary;
  requests: PermissionRequest[];
  queue: QueueState;
  taskId: string | null;
  queueDisabled: boolean;
  onEditQueued: (text: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation('common');
  const pager = useHitlPager(requests);
  return (
    <div className="hitl-queue-popover">
      {/* The popover sub-view header shared with the model configuration popover: the action on
          the left, then the title. */}
      <div className="hitl-queue-header">
        {/* Popover close controls carry no tooltip: the glyph and accessible name suffice. */}
        <IconButton label={t('close')} size="icon-xs" tooltip={false} onClick={onClose}>
          <X />
        </IconButton>
        <span className="hitl-queue-title" title={summary.title}>
          {summary.title}
        </span>
        {pager.count > 1 && <PagerControls pager={pager} />}
      </div>
      {/* The queue reorders inside this scroller; motion must account for its offset. Opening
          the view from the pill focuses the first action here, past the header close. */}
      <motion.div layoutScroll className="hitl-queue-body" data-panel-focus>
        {pager.request && (
          <HitlRegion
            request={pager.request}
            focusOnMount={pager.focusOnMount}
            hideApprovalTitle={summary.mergedApproval}
          />
        )}
        {summary.hasQueue && taskId !== null && (
          <QueueRegion
            taskId={taskId}
            queue={queue}
            disabled={queueDisabled}
            onEdit={onEditQueued}
          />
        )}
      </motion.div>
    </div>
  );
}
