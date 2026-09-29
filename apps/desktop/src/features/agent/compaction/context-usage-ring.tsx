import { useTranslation } from 'react-i18next';
import type { TaskContextState } from '@ai/agent-contracts';
import { Button } from '@ai/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ai/ui/components/tooltip';
import { formatContextWindow, formatTokenCount } from '../../providers/context-window';

/** Usage from which the ring warns, then shows the error color; the service compacts near 85%. */
const WARNING_PERCENT = 75;
const ERROR_PERCENT = 90;

/**
 * How full the open task's context is, as a small ring next to the composer's model trigger:
 * muted below 75%, the warning color from 75%, the destructive color from 90%. The tooltip gives
 * the token counts and says when the service compacts on its own. Hidden while the usage is
 * unknown (no run yet, or right after a compaction). Like `FieldHint`, the trigger is a button
 * only so keyboard focus can open the tooltip; it has no action. It is a glass control beside the
 * glass model trigger.
 */
export function ContextUsageRing({ context }: { context: TaskContextState }) {
  const { t } = useTranslation('panel');
  if (context.percent === null) return null;
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
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="glass"
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
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {/* The shared content lays children out in a row; the two lines stack. */}
        <span className="flex flex-col">
          <span>{usage}</span>
          <span className="opacity-70">{autoCompact}</span>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
