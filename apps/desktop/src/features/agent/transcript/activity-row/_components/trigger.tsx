import type { ComponentProps } from 'react';
import { Button } from '@atd/ui/components/button';
import { cn } from '@atd/ui/lib/utils';
import { useActivityRow } from '../_hooks/use-activity-row';
import { composeEventHandlers } from '../_utils/compose-event-handlers';

export interface ActivityRowTriggerProps extends ComponentProps<'button'> {}

/**
 * Expand toggle for the row. The heading content comes from children so no
 * locale lives in the generic. The consumer `onClick` runs first;
 * `preventDefault()` vetoes the internal toggle.
 *
 * v1 renders the shared ghost Button host only. A custom trigger host was
 * deliberately cut: no v1 consumer replaces it, and the Slot primitive lives
 * in `@atd/ui`'s dependency closure, which desktop files cannot import
 * directly under pnpm isolation. Revisit with an `@atd/ui` Slot re-export if a
 * consumer ever needs host replacement.
 */
export function Trigger({
  type,
  className,
  style,
  onClick,
  children,
  ...props
}: ActivityRowTriggerProps) {
  const { state, actions, meta } = useActivityRow();
  return (
    <Button
      {...props}
      variant="ghost"
      type={type ?? 'button'}
      id={meta.triggerId}
      aria-expanded={state.open}
      aria-controls={meta.contentId}
      data-slot="activity-row-trigger"
      data-state={state.open ? 'open' : 'closed'}
      className={cn('activity-trigger', className)}
      style={style}
      onClick={composeEventHandlers(onClick, () => actions.toggleOpen())}
    >
      {children}
    </Button>
  );
}
