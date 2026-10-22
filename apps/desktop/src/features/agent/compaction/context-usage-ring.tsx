import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskContextState } from '@atd/agent-contracts';
import { Button } from '@atd/ui/components/button';
import { Popover, PopoverContent, PopoverTrigger } from '@atd/ui/components/popover';
import { formatContextWindow, formatTokenCount } from '../../providers/context-window';
import { ContextUsageDetail } from './context-usage-detail';
import { useContextBreakdown } from './use-context-breakdown';

/** Usage from which the ring warns, then shows the error color; the service compacts near 85%. */
const WARNING_PERCENT = 75;
const ERROR_PERCENT = 90;

/**
 * How full the open task's context is, as a small ring next to the composer's model trigger:
 * muted below 75%, the warning color from 75%, the destructive color from 90%. Clicking the ring
 * opens a popover with the usage by category (`ContextUsageDetail`), fetched while it is open; as
 * a popover trigger it has no tooltip, and its accessible name carries the token counts and when
 * the service compacts on its own. Hidden while the usage is unknown (no run yet, or right after a
 * compaction). Like the model trigger beside it, the ring is transparent until hovered
 * (`glass-ghost`).
 */
export function ContextUsageRing({
  taskId,
  context,
}: {
  taskId: string;
  context: TaskContextState;
}) {
  const { t } = useTranslation('panel');
  const [open, setOpen] = useState(false);
  const { breakdown, error } = useContextBreakdown(taskId, context, open);
  if (context.percent === null) {
    // A hidden ring (a compaction cleared the usage) must not reopen its popover when it returns.
    if (open) setOpen(false);
    return null;
  }
  const percent = Math.round(context.percent);
  const level =
    percent >= ERROR_PERCENT ? 'error' : percent >= WARNING_PERCENT ? 'warning' : 'normal';
  const usage =
    context.tokens !== null && context.contextWindow !== null
      ? t('composer.context.usage', {
          tokens: formatTokenCount(context.tokens),
          window: formatContextWindow(context.contextWindow),
          percent,
        })
      : t('composer.context.percent', { percent });
  const autoCompact = t('composer.context.autoCompact');
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="glass-ghost"
          size="icon-xs"
          className="context-usage"
          data-level={level}
          aria-label={`${t('composer.context.label')}: ${usage}. ${autoCompact}`}
        >
          <svg className="context-usage-ring size-3.5" viewBox="0 0 16 16" aria-hidden>
            <circle className="context-usage-track" cx="8" cy="8" r="6" />
            {percent > 0 && (
              <circle
                className="context-usage-value"
                cx="8"
                cy="8"
                r="6"
                pathLength={100}
                strokeDasharray={`${Math.min(percent, 100)} 100`}
              />
            )}
          </svg>
        </Button>
      </PopoverTrigger>
      {/* The rows expand, collapse and scroll while open, so they render beside the glass rather
          than inside it (`material="backdrop"`), where WebKit's system glass would keep drawing
          the old rows over the new layout. */}
      <PopoverContent side="top" material="backdrop" className="w-88">
        <ContextUsageDetail context={context} breakdown={breakdown} error={error} />
      </PopoverContent>
    </Popover>
  );
}
