import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { motion } from 'motion/react';
import type { PermissionRequest } from '../../electron/agent/permission-schema';
import type { QueueState } from '../../electron/agent/transcript-schema';
import { HitlRegion } from './hitl-region';
import { IconButton } from './icon-button';
import { QueueRegion } from './queue-region';
import type { HitlSummary } from './use-hitl-summary';
import './hitl-queue-popover.css';

/**
 * The composer popover's HITL view: the requests (top, urgent) and the queue (bottom) under a
 * header whose close button dismisses the view, never resolves a request. The body owns
 * scrolling so neither region can push the composer surface around.
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
      </div>
      {/* The queue reorders inside this scroller; motion must account for its offset. Opening
          the view from the pill focuses the first action here, past the header close. */}
      <motion.div layoutScroll className="hitl-queue-body" data-panel-focus>
        {requests.length > 0 && (
          <HitlRegion requests={requests} hideApprovalTitle={summary.mergedApproval} />
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
