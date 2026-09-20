import { useTranslation } from 'react-i18next';
import type { QueueState } from '../../electron/agent/transcript-schema';
import { ComposerQueue } from './composer-queue';

/**
 * Queue region at the bottom of the composer popover. Same steer/followUp display and
 * edit/send-now/remove actions as the old in-flow slot, now floating so queue changes never
 * resize the composer surface or churn the footer height.
 */
export function QueueRegion({
  taskId,
  queue,
  disabled = false,
  onEdit,
}: {
  taskId: string;
  queue: QueueState;
  disabled?: boolean;
  onEdit: (text: string) => void;
}) {
  const { t } = useTranslation('panel');
  const count = queue.steering.length + queue.followUp.length;
  if (count === 0) return null;
  return (
    // A named section carries the implicit region role; no explicit role needed.
    <section aria-label={t('composer.queuedCount', { count })} className="queue-region">
      <ComposerQueue taskId={taskId} queue={queue} disabled={disabled} onEdit={onEdit} />
    </section>
  );
}
