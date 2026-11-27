import { useState, type ComponentProps, type ReactNode } from 'react';
import { Button } from '@atd/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@atd/ui/components/tooltip';
import { useCompacted } from './one-line-actions';

/**
 * A secondary action in a bar that stays one line (`one-line-actions.ts`): its icon and label, and
 * only its icon while the bar is short of room, its label then its tooltip and, kept in place for
 * assistive technology, still its name. `hint` is a tooltip it always has (why it cannot act now,
 * what it does); compacted, the hint follows the label. `iconAtRest={false}` draws the icon only
 * compacted, for an action whose label alone says it. Outside such a bar it is an ordinary
 * labelled button.
 */
export function BarAction({
  icon,
  label,
  hint,
  iconAtRest = true,
  ...props
}: Omit<ComponentProps<typeof Button>, 'ref' | 'children'> & {
  icon: ReactNode;
  label: string;
  hint?: ReactNode;
  iconAtRest?: boolean;
}) {
  const { ref, compact } = useCompacted<HTMLButtonElement>();
  const [open, setOpen] = useState(false);
  const tip = compact ? <CompactTip label={label} detail={hint} /> : hint;
  return (
    <Tooltip open={tip ? open : false} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <Button ref={ref} data-bar-action="icon" {...props}>
          {iconAtRest || compact ? icon : null}
          <span data-slot="bar-label">{label}</span>
        </Button>
      </TooltipTrigger>
      {tip ? (
        <TooltipContent side="top" sideOffset={4} className="max-w-80">
          {tip}
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
}

/** A compacted action's tooltip: its label, then what its own tooltip said. */
export function CompactTip({ label, detail }: { label: string; detail?: ReactNode }) {
  return (
    <>
      {label}
      {detail ? <span className="block text-pretty opacity-80">{detail}</span> : null}
    </>
  );
}
