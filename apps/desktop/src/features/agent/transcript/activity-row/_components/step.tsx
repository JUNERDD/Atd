import type { ComponentProps } from 'react';
import { cn } from '@ai/ui/lib/utils';

export interface ActivityRowStepProps extends ComponentProps<'li'> {}

/** One rail step; the spine and branch come from agent.css. */
export function Step({ className, style, children, ...props }: ActivityRowStepProps) {
  return (
    <li
      {...props}
      data-slot="activity-row-step"
      className={cn('phase-step', className)}
      style={style}
    >
      {children}
    </li>
  );
}
