import type { ComponentProps } from 'react';
import { Button } from '@atd/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@atd/ui/components/tooltip';
import { ShortcutHint } from '../approval-controls';

/**
 * An icon button whose tooltip names its action and shows its key, as keycaps after the label
 * (`ShortcutHint`). `IconButton` takes its tooltip as plain text, so a button with a key to show
 * builds on the same shared `Button` and `Tooltip` instead.
 */
export function HintButton({
  label,
  accelerator,
  children,
  ...props
}: ComponentProps<typeof Button> & {
  /** The accessible name and the tooltip's text. */
  label: string;
  /** The key that does the same, in accelerator form (`Shift+Enter`). */
  accelerator: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {label}
        <ShortcutHint accelerator={accelerator} />
      </TooltipContent>
    </Tooltip>
  );
}
