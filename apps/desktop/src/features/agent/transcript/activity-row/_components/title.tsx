import type { ComponentProps } from 'react';
import { cn } from '@atd/ui/lib/utils';
import { useActivityRow } from '../_hooks/use-activity-row';

export interface ActivityRowTitleProps extends ComponentProps<'span'> {}

/**
 * Row heading slot. Copy comes from children; no locale lives in the generic.
 */
export function Title({ className, style, children, ...props }: ActivityRowTitleProps) {
  const { state } = useActivityRow();
  return (
    <span
      {...props}
      data-slot="activity-row-title"
      data-state={state.open ? 'open' : 'closed'}
      className={cn('min-w-0 flex-1 truncate text-left', className)}
      style={style}
    >
      {children}
    </span>
  );
}
