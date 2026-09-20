import { useRef, useState, type ComponentProps } from 'react';
import { Button } from '@ai/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ai/ui/components/tooltip';

export function IconButton({
  label,
  children,
  tooltip = true,
  tooltipSide = 'bottom',
  tooltipPinned,
  tooltipDismissOnClick = false,
  ...props
}: ComponentProps<typeof Button> & {
  /** Short tooltip text; use aria-label when the accessible name needs more context. */
  label: string;
  /** Set false to render a bare labeled button with no tooltip. Defaults to true. */
  tooltip?: boolean;
  tooltipSide?: ComponentProps<typeof TooltipContent>['side'];
  /** Pins the tooltip open while true so a label change can act as feedback; hover, focus, and dismissal behavior resume once it clears. */
  tooltipPinned?: boolean;
  /** Dismiss the tooltip on click for triggers that open a menu or overlay so it does not linger over it. Defaults to false: the tooltip stays open while hovered or focused. */
  tooltipDismissOnClick?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Default dismissal is pointer leave only: while the pointer hovers the trigger, click,
  // blur, Escape, and scroll closes are ignored so the label (and action feedback such as
  // copy -> copied) stays visible. Without a hover (keyboard focus), blur and Escape still
  // dismiss; otherwise a focus-opened tooltip could never close.
  const hoverRef = useRef(false);
  const keepOnClickRef = useRef(false);
  if (!tooltip) {
    return (
      <Button type="button" variant="ghost" size="icon-sm" aria-label={label} {...props}>
        {children}
      </Button>
    );
  }
  function handleOpenChange(next: boolean) {
    if (next || tooltipDismissOnClick) {
      setOpen(next);
      return;
    }
    if (hoverRef.current) return;
    // Keyboard activation without hover keeps the focus tooltip open across the click.
    if (keepOnClickRef.current) return;
    setOpen(next);
  }
  function handlePointerEnter() {
    hoverRef.current = true;
  }
  function handlePointerLeave() {
    // Runs before the Radix leave-close in the same composed event, so the leave-close
    // observes the cleared flag and is still honored.
    hoverRef.current = false;
  }
  function keepOnClick() {
    if (tooltipDismissOnClick) return;
    keepOnClickRef.current = true;
    // The Radix close runs synchronously later in the same event; clear after it so a
    // later blur or Escape close without hover is still honored.
    queueMicrotask(() => {
      keepOnClickRef.current = false;
    });
  }
  return (
    <Tooltip open={tooltipPinned || open} onOpenChange={handleOpenChange}>
      <TooltipTrigger
        asChild
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onPointerDown={keepOnClick}
        onClick={keepOnClick}
      >
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
