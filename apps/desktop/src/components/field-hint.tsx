import type { ComponentProps, ReactNode } from 'react';
import { CircleQuestionMark } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@atd/ui/components/tooltip';

/**
 * A compact label affordance for item hints: the hint copy lives in the tooltip instead of a
 * visible description row, keeping dense forms on one track. Hover and keyboard focus both
 * open it.
 */
export function FieldHint({
  text,
  side = 'top',
  icon,
}: {
  /** Hint copy; also names the trigger for assistive technology while the tooltip is closed. */
  text: string;
  side?: ComponentProps<typeof TooltipContent>['side'];
  /** The trigger glyph; a question mark by default. */
  icon?: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={text}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          {icon ?? <CircleQuestionMark className="size-3.5" />}
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} sideOffset={4}>
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
