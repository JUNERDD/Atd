import { useState, type ComponentProps } from 'react';
import { Button } from '@ai/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ai/ui/components/tooltip';

export function IconButton({
  label,
  children,
  tooltip = true,
  tooltipSide = 'bottom',
  tooltipPinned,
  ...props
}: ComponentProps<typeof Button> & {
  /** Short tooltip text; use aria-label when the accessible name needs more context. */
  label: string;
  /** Set false to render a bare labeled button with no tooltip. Defaults to true. */
  tooltip?: boolean;
  tooltipSide?: ComponentProps<typeof TooltipContent>['side'];
  /** Pins the tooltip open while true so a label change can act as feedback; hover, focus, and dismissal behavior resume once it clears. */
  tooltipPinned?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!tooltip) {
    return (
      <Button type="button" variant="ghost" size="icon-sm" aria-label={label} {...props}>
        {children}
      </Button>
    );
  }
  return (
    <Tooltip open={tooltipPinned || open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
