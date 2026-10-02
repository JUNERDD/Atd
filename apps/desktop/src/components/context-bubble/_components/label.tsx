import type { ComponentProps } from 'react';
import { cn } from '@atd/ui/lib/utils';
import { useContextBubble } from '../_hooks/use-context-bubble';
import { composeEventHandlers } from '../_utils/compose-event-handlers';

export interface ContextBubbleLabelProps extends ComponentProps<'button'> {}

/**
 * Expand toggle for the bubble. The label text (and any icon) comes from
 * children so no locale lives in the generic. The consumer `onClick` runs
 * first; `preventDefault()` vetoes the internal toggle.
 */
export function Label({
  type = 'button',
  className,
  style,
  onClick,
  children,
  ...props
}: ContextBubbleLabelProps) {
  const { state, actions, meta } = useContextBubble();
  return (
    <button
      {...props}
      type={type}
      id={meta.labelId}
      aria-expanded={state.open}
      aria-controls={meta.contentId}
      data-slot="context-bubble-label"
      data-state={state.open ? 'open' : 'closed'}
      className={cn(
        'flex w-full min-w-0 items-center gap-2 text-left text-sm font-medium',
        className,
      )}
      style={style}
      onClick={composeEventHandlers(onClick, () => actions.toggleOpen())}
    >
      {children}
    </button>
  );
}
