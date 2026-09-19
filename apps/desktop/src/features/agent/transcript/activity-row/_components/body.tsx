import type { ComponentProps } from 'react';
import { useActivityRow } from '../_hooks/use-activity-row';

export interface ActivityRowBodyProps extends ComponentProps<'div'> {}

/**
 * Unfolded body slot with no layout opinion; the domain passes
 * thinking-full/tool-body classes for its own arrangement.
 */
export function Body({ className, style, children, ...props }: ActivityRowBodyProps) {
  const { state } = useActivityRow();
  return (
    <div
      {...props}
      data-slot="activity-row-body"
      data-state={state.open ? 'open' : 'closed'}
      className={className}
      style={style}
    >
      {children}
    </div>
  );
}
