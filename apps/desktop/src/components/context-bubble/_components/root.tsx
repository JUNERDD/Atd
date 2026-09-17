import { useCallback, useId, useMemo, useState, type ComponentProps } from 'react';
import { cn } from '@ai/ui/lib/utils';
import { ContextBubbleContext } from '../_hooks/use-context-bubble';

export interface ContextBubbleRootProps extends ComponentProps<'div'> {
  /** Controlled visibility of the preview region. */
  open?: boolean;
  /** Uncontrolled initial visibility. Defaults to expanded. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * State owner and visual frame for a captured-context bubble. Publishes the
 * open/action/id contract; every part below reads it. Controlled and
 * uncontrolled modes share one observable contract: `onOpenChange` fires on
 * every toggle request, and `data-state` plus Label/Preview ARIA always
 * reflect the effective value.
 */
export function Root({
  open: controlledOpen,
  defaultOpen = true,
  onOpenChange,
  className,
  style,
  children,
  ...props
}: ContextBubbleRootProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (controlledOpen === undefined) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [controlledOpen, onOpenChange],
  );
  const toggleOpen = useCallback(() => {
    setOpen(!open);
  }, [open, setOpen]);
  const baseId = useId();
  const value = useMemo(
    () => ({
      state: { open },
      actions: { setOpen, toggleOpen },
      meta: { contentId: `${baseId}-preview`, labelId: `${baseId}-label` },
    }),
    [open, setOpen, toggleOpen, baseId],
  );
  return (
    <ContextBubbleContext value={value}>
      <div
        {...props}
        data-slot="context-bubble"
        data-state={open ? 'open' : 'closed'}
        className={cn('flex min-w-0 flex-col gap-2', className)}
        style={style}
      >
        {children}
      </div>
    </ContextBubbleContext>
  );
}
