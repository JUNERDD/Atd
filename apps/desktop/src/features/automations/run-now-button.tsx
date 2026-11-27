import type { ComponentProps } from 'react';
import { Play } from 'lucide-react';
import { Button } from '@atd/ui/components/button';
import { BarAction } from '../../components/bar-action';

/**
 * Run now with a label (the run history's and the editor's; the list row has its icon button).
 * While the automation cannot run, the button stays focusable and its tooltip says why, as the
 * row's does; a busy button ignores presses without a reason. In the editor's footer it shows its
 * icon alone where the footer is short of room (`BarAction`).
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
  return (
    <BarAction
      type="button"
      variant={variant}
      icon={<Play data-icon="inline-start" />}
      label={label}
      hint={reason ?? undefined}
      aria-disabled={reason !== null || busy || undefined}
      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      onClick={() => {
        if (reason === null && !busy) onRun();
      }}
    />
  );
}
