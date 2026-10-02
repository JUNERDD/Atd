import type { ComponentProps } from 'react';
import { cn } from '@atd/ui/lib/utils';
import { useContextBubble } from '../_hooks/use-context-bubble';

export interface ContextBubbleFilesProps extends ComponentProps<'ul'> {}

/**
 * List container for attached files. Iteration is consumer-owned: the
 * consumer maps data into `FileItem` parts or fully custom `<li>` renderers.
 * This container never inspects its children, so order and nesting are free.
 */
export function Files({ className, style, children, ...props }: ContextBubbleFilesProps) {
  useContextBubble();
  return (
    <ul
      {...props}
      data-slot="context-bubble-files"
      className={cn('flex min-w-0 flex-col gap-1.5', className)}
      style={style}
    >
      {children}
    </ul>
  );
}
