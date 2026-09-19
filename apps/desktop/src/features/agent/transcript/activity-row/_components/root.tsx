import { useCallback, useId, useMemo, useState, type ComponentProps } from 'react';
import { Collapsible } from '@ai/ui/components/collapsible';
import { cn } from '@ai/ui/lib/utils';
import { ActivityRowContext } from '../_hooks/use-activity-row';

export interface ActivityRowRootProps extends ComponentProps<'div'> {
  /** Controlled visibility of the body region. */
  open?: boolean;
  /** Uncontrolled initial visibility. Defaults to collapsed. */
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Row status, reflected as `data-status` when provided. */
  status?: string;
}

/**
 * State owner and visual frame for an expandable transcript row. Publishes the
 * open/action/id contract; every part below reads it. Controlled and
 * uncontrolled modes share one observable contract: `onOpenChange` fires on
 * every set request, and `data-state` plus Trigger/Content ARIA always
 * reflect the effective value.
 */
export function Root({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  status,
  className,
  style,
  children,
  ...props
}: ActivityRowRootProps) {
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
      state: { open, status },
      actions: { setOpen, toggleOpen },
      meta: { contentId: `${baseId}-content`, triggerId: `${baseId}-trigger` },
    }),
    [open, status, setOpen, toggleOpen, baseId],
  );
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <ActivityRowContext value={value}>
        <div
          {...props}
          data-slot="activity-row"
          data-state={open ? 'open' : 'closed'}
          data-status={status ?? undefined}
          className={cn('flex min-w-0 flex-col', className)}
          style={style}
        >
          {children}
        </div>
      </ActivityRowContext>
    </Collapsible>
  );
}
