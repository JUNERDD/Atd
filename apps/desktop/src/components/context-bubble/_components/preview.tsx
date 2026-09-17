import type { ComponentProps } from 'react';
import { ScrollArea } from '@ai/ui/components/scroll-area';
import { cn } from '@ai/ui/lib/utils';
import { useContextBubble } from '../_hooks/use-context-bubble';

export interface ContextBubblePreviewProps extends ComponentProps<typeof ScrollArea> {}

/**
 * Collapsible text preview. Rendered only while open; siblings such as Files
 * and Meta stay mounted so the consumer decides what expansion hides. To hide
 * everything, nest Files/Meta inside Preview. Defaults reuse the agent input
 * preview surface (`.input-preview` / `.text-preview-viewport`); extend or
 * replace it through `className` / `viewportClassName`.
 */
export function Preview({
  className,
  viewportClassName,
  children,
  ...props
}: ContextBubblePreviewProps) {
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
      viewportClassName={cn('text-preview-viewport', viewportClassName)}
    >
      {children}
    </ScrollArea>
  );
}
