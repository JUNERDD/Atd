import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@ai/ui/components/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@ai/ui/components/collapsible';

/**
 * One expandable transcript row: a ghost trigger sharing the activity hover contract, a
 * trailing chevron that rotates open, and the unfolded body. Thinking and tool steps render
 * through here so the affordance and hover can never drift apart again.
 */
export function CollapsibleRow({
  open,
  onOpenChange,
  label,
  heading,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible name; omitted, the trigger names itself from the heading content. */
  label?: string;
  /** Row content ahead of the chevron: title, target, status. */
  heading: ReactNode;
  /** Unfolded body, including its own layout wrapper. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className={className}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="activity-trigger" aria-label={label}>
          {heading}
          <ChevronRight className={open ? 'rotate-90' : ''} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
