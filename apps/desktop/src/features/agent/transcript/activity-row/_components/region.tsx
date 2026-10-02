import type { ComponentProps } from 'react';
import { useActivityRow } from '../_hooks/use-activity-row';

export interface ActivityRowRegionProps extends ComponentProps<'div'> {}

/**
 * Always-mounted body region for a row that decides what its body shows itself. `Content`
 * unmounts its children while closed; a Region stays, so a closed row can keep part of its body
 * in view (the live phase peek) and steps keep their state across open and closed. It carries
 * the id that Trigger's `aria-controls` names and mirrors the open state.
 */
export function Region({ id, className, style, children, ...props }: ActivityRowRegionProps) {
  const { state, meta } = useActivityRow();
  return (
    <div
      {...props}
      id={id ?? meta.contentId}
      data-slot="activity-row-region"
      data-state={state.open ? 'open' : 'closed'}
      className={className}
      style={style}
    >
      {children}
    </div>
  );
}
