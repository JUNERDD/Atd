import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@ai/ui/components/collapsible';

/**
 * One expandable transcript row: a ghost trigger sharing the activity hover contract, a
 * leading icon that swaps to the expanding chevron on hover (like the phase header), and the
 * unfolded body. Thinking and tool steps render through here so the affordance and hover can
 * never drift apart again.
 */
export function CollapsibleRow({
  open,
  onOpenChange,
  label,
  icon,
  heading,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name; omitted, the trigger names itself from the heading content. */
  label?: string;
  /** Leading icon shown at rest; hover swaps it for the expanding chevron. */
  icon: ReactNode;
  /** Row content after the icon: title, target, status. */
  heading: ReactNode;
  /** Unfolded body, including its own layout wrapper. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className={className}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="activity-trigger" aria-label={label}>
          {/*
           * The two icons share one box, so the swap is instant: fading between them leaves both
           * half-drawn on top of each other.
           */}
          <span className="row-icon-swap">
            {icon}
            <ChevronRight className={`row-chevron${open ? ' rotate-90' : ''}`} strokeWidth={1.75} />
          </span>
          {heading}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
