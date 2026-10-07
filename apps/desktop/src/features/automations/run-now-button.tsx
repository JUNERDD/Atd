import type { ComponentProps } from 'react';
import { Play } from 'lucide-react';
import { Button } from '@atd/ui/components/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@atd/ui/components/tooltip';

/**
 * Run now with a label (the run history's and the editor's; the list row has its icon button).
 * While the automation cannot run, the button stays focusable and its tooltip says why, as the
 * row's does; a busy button ignores presses without a reason.
 */
export function RunNowButton({
  label,
  reason,
  busy = false,
  variant,
  onRun,
}: {
  label: string;
  /** Why it cannot run now (`runBlockWords`); null when it can. */
  reason: string | null;
  busy?: boolean;
  variant?: ComponentProps<typeof Button>['variant'];
  onRun: () => void;
}) {
  const button = (
    <Button
      type="button"
      variant={variant}
      aria-disabled={reason !== null || busy || undefined}
      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      onClick={() => {
        if (reason === null && !busy) onRun();
      }}
    >
      <Play data-icon="inline-start" />
      {label}
    </Button>
  );
  if (reason === null) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {reason}
      </TooltipContent>
    </Tooltip>
  );
}
