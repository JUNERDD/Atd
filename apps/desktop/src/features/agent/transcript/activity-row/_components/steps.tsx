import type { ComponentProps } from 'react';
import { cn } from '@ai/ui/lib/utils';

export interface ActivityRowStepsProps extends ComponentProps<'ul'> {}

/**
 * Connector-rail list. The consumer maps Step children; children are never
 * inspected.
 */
export function Steps({ className, style, children, ...props }: ActivityRowStepsProps) {
  return (
    <ul
      {...props}
      data-slot="activity-row-steps"
      className={cn('phase-steps m-0 list-none p-0', className)}
      style={style}
    >
      {children}
    </ul>
  );
}
