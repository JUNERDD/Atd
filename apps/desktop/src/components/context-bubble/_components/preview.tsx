import type { ComponentProps } from 'react';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { cn } from '@ai/ui/lib/utils';
import { useContextBubble } from '../_hooks/use-context-bubble';

export interface ContextBubblePreviewProps extends Omit<
  ComponentProps<typeof ScrollArea>,
  'viewportClassName'
> {}

/**
 * Collapsible text preview. Rendered only while open; siblings such as Files
 * and Meta stay mounted so the consumer decides what expansion hides. To hide
 * everything, nest Files/Meta inside Preview. Defaults reuse the agent input
 * preview surface (`.input-preview` with a `max-h-[inherit]` viewport); extend or
 * replace it through `className`.
 */
export function Preview({ className, children, ...props }: ContextBubblePreviewProps) {
  const { state, meta } = useContextBubble();
  if (!state.open) return null;
  return (
    <ScrollArea
      {...props}
      id={meta.contentId}
      aria-labelledby={meta.labelId}
      data-slot="context-bubble-preview"
      data-state="open"
      className={cn('input-preview', className)}
      viewportClassName="max-h-[inherit]"
    >
      {children}
    </ScrollArea>
  );
}
