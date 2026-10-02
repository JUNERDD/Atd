import type { ComponentProps } from 'react';
import { cn } from '@atd/ui/lib/utils';
import { useContextBubble } from '../_hooks/use-context-bubble';

export interface ContextBubbleMetaProps extends ComponentProps<'p'> {}

/**
 * Muted metadata line (for example capture time or source). Content comes
 * from children so no locale lives in the generic.
 */
export function Meta({ className, style, children, ...props }: ContextBubbleMetaProps) {
  useContextBubble();
  return (
    <p
      {...props}
      data-slot="context-bubble-meta"
      className={cn('text-xs text-muted-foreground', className)}
      style={style}
    >
      {children}
    </p>
  );
}
