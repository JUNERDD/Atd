import { useTranslation } from 'react-i18next';
import type { SubagentChildSummary } from '@ai/agent-contracts';
import { Shimmer } from '@ai/ui/components/ai-elements/shimmer';
import { cn } from '@ai/ui/lib/utils';
import type { PermissionRequest } from '../../../../electron/agent/permission-schema';
import { formatElapsed } from './elapsed';
import { childTokens } from './subagent-children';

/**
 * One child's state and usage on one wrapping line in the drill-in header: the state reads first (shimmering while the child works, the waiting text while a
 * request of it is pending), then the tool count, duration, and tokens. `withModel` adds the
 * model the header has room for.
 */
export function SubagentStatus({
  child,
  waiting,
  withModel = false,
  className,
}: {
  child: SubagentChildSummary;
  waiting: PermissionRequest['kind'] | null;
  withModel?: boolean;
  className?: string;
}) {
  const { t, i18n } = useTranslation('tasks');
  const running = child.status === 'running';
  const state = waiting
    ? waiting === 'input'
      ? t('permission.waitingAnswer')
      : t('permission.waitingApproval')
    : running
      ? child.currentTool
        ? t('subagent.runningTool', { tool: child.currentTool })
        : t('activity.running')
      : child.status === 'completed'
        ? t('activity.completed')
        : child.status === 'failed'
          ? t('activity.failed')
          : t('activity.interrupted');
  const tokens = childTokens(child);
  const compact = new Intl.NumberFormat(i18n.language, {
    notation: 'compact',
    maximumFractionDigits: 1,
  });
  const meta = [
    withModel ? child.model : undefined,
    child.toolCount === 1 ? t('subagent.toolOne') : t('subagent.tools', { count: child.toolCount }),
    child.durationMs > 0 ? formatElapsed(child.durationMs) : null,
    tokens ? t('subagent.tokens', { amount: compact.format(tokens) }) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <p
      className={cn(
        'm-0 flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground',
        className,
      )}
    >
      <span
        className={cn(
          'min-w-0 max-w-full truncate font-medium',
          child.status === 'failed' && !waiting ? 'text-destructive' : 'text-foreground',
        )}
        title={state}
      >
        {running && !waiting ? <Shimmer as="span">{state}</Shimmer> : state}
      </span>
      <span className="min-w-0 max-w-full truncate" title={meta}>
        {meta}
      </span>
    </p>
  );
}
