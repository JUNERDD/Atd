import type { ComponentProps } from 'react';
import { cn } from '@ai/ui/lib/utils';
import { useActivityRow } from '../_hooks/use-activity-row';

export interface ActivityRowMetaProps extends ComponentProps<'span'> {}

/**
 * Trailing meta slot. The domain passes tool-chip/activity-meta classes when
 * it needs the chip treatment.
 */
export function Meta({ className, style, children, ...props }: ActivityRowMetaProps) {
  const { state } = useActivityRow();
  return (
    <span
      {...props}
      data-slot="activity-row-meta"
      data-state={state.open ? 'open' : 'closed'}
      className={cn('text-left text-xs text-muted-foreground', className)}
      style={style}
    >
      {children}
    </span>
  );
}
