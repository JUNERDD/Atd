import { MonitorPlay } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@atd/ui/components/button';

/** The task's live screens: how many it streams, their names, and what opens them. */
export interface PillMonitor {
  count: number;
  labels: string;
  show: () => void;
}

/**
 * The capsule's last part while the task streams screens. Unlike the parts beside it, it opens
 * the native Screen Monitor window rather than a view of the composer's popover, so it is a plain
 * action with their xs `glass-ghost` geometry. The source names, too long for the capsule, are its
 * tooltip and part of its accessible name.
 */
export function MonitorPart({ count, labels, show }: PillMonitor) {
  const { t } = useTranslation('tasks');
  const text = t('computer.preview.showMonitor', { count });
  return (
    <Button
      type="button"
      variant="glass-ghost"
      size="xs"
      className="composer-progress-part composer-progress-trigger border-0"
      aria-label={`${text} · ${labels}`}
      title={labels}
      onClick={show}
    >
      <MonitorPlay aria-hidden />
      <span className="truncate">{text}</span>
    </Button>
  );
}
