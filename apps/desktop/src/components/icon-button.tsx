import type { ComponentProps } from 'react';
import { Button } from '@ai/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@ai/ui/components/tooltip';

export function IconButton({
  label,
  children,
  tooltipSide = 'bottom',
  ...props
}: ComponentProps<typeof Button> & {
  label: string;
  tooltipSide?: ComponentProps<typeof TooltipContent>['side'];
}) {
  return (
    <Tooltip>
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
